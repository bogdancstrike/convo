import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';
import type { CallInvite } from './calls';
import type { ChatMessage } from './model';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * A second device linked to the same account through the real provisioning flow, and call
 * signalling between accounts.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let anaLaptop: TestDevice | undefined;

const dto = (d: TestDevice) => ({ accountId: d.account.accountId, username: d.account.username, displayName: d.account.displayName });
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => (await d.client.messages(conversationId)).some(predicate));
  return (await d.client.messages(conversationId)).find(predicate)!;
}

beforeEach(async () => {
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  anaLaptop = undefined;
});
afterEach(() => server.close(...[ana, bob, anaLaptop].filter((d): d is TestDevice => !!d)));

async function linkLaptop(): Promise<TestDevice> {
  anaLaptop = await server.linkDevice(ana);
  await anaLaptop.client.start();
  await until(() => anaLaptop!.connection === 'online');
  return anaLaptop;
}

describe('linking a second device', () => {
  it('the new device shares the account identity and appears in the device list', async () => {
    const laptop = await linkLaptop();
    expect(laptop.account.accountId).toBe(ana.account.accountId);
    expect(server.accounts.get(ana.account.accountId)!.devices.size).toBe(2);
    expect((await ana.client.devices()).map((d) => d.deviceId).sort()).toEqual([1, 2]);
  });

  it('a declined request never completes', async () => {
    const { LinkRequest } = await import('./linking');
    const request = await LinkRequest.start(server.api(ana.account), 'token', 'Unknown browser');
    const [incoming] = await ana.client.incomingLinkRequests();
    expect(incoming!.label).toBe('Unknown browser');
    await ana.client.declineLink(incoming!.provisioningId);
    expect(await request.poll()).toBe('cancelled');
  });

  it('messages to the account reach both devices', async () => {
    const laptop = await linkLaptop();
    await bob.client.openConversation(dto(ana));
    await bob.client.sendText(ana.account.accountId, 'to all your devices');
    await see(ana, bob.account.accountId, (m) => m.body === 'to all your devices');
    await see(laptop, bob.account.accountId, (m) => m.body === 'to all your devices');
  });

  it('what one device sends shows up on the other as sent', async () => {
    const laptop = await linkLaptop();
    await ana.client.openConversation(dto(bob));
    await ana.client.sendText(bob.account.accountId, 'from my phone');
    await see(bob, ana.account.accountId, (m) => m.body === 'from my phone');
    const synced = await see(laptop, bob.account.accountId, (m) => m.body === 'from my phone');
    expect(synced.direction).toBe('out');
  });

  it('a device that was already talking learns about the new device and includes it', async () => {
    await bob.client.openConversation(dto(ana));
    await bob.client.sendText(ana.account.accountId, 'before the laptop');
    await see(ana, bob.account.accountId, (m) => m.body === 'before the laptop');
    const laptop = await linkLaptop();
    await bob.client.sendText(ana.account.accountId, 'after the laptop');
    await see(laptop, bob.account.accountId, (m) => m.body === 'after the laptop');
    await see(ana, bob.account.accountId, (m) => m.body === 'after the laptop');
  });

  it('an unlinked device stops receiving and is told it was revoked', async () => {
    const laptop = await linkLaptop();
    let revoked = false;
    laptop.client.on('revoked', () => { revoked = true; });
    await ana.client.unlinkDevice(2);
    await until(() => revoked);
    await bob.client.openConversation(dto(ana));
    await bob.client.sendText(ana.account.accountId, 'only the phone now');
    await see(ana, bob.account.accountId, (m) => m.body === 'only the phone now');
  });
});

describe('call signalling', () => {
  // Calls ring between people who already chat (a ring from a stranger is not shown).
  beforeEach(async () => {
    await ana.client.openConversation(dto(bob));
    await ana.client.sendText(bob.account.accountId, 'can we talk?');
    await see(bob, ana.account.accountId, (m) => m.body === 'can we talk?');
    await bob.client.acceptRequest(ana.account.accountId);
  });

  it('a call rings the other side, which can decline it', async () => {
    await ana.client.openConversation(dto(bob));
    const invites: CallInvite[] = [];
    bob.client.on('call', (event) => { const e = event as { type: string; invite?: CallInvite }; if (e.type === 'incoming' && e.invite) invites.push(e.invite); });
    const remote: string[] = [];
    ana.client.on('call', (event) => { const e = event as { type: string; action?: string }; if (e.type === 'remote' && e.action) remote.push(e.action); });
    const { join, key } = await ana.client.startCall(bob.account.accountId, true);
    expect(join.video).toBe(true); expect(key).toBeTruthy();
    expect(server.callsCreated[0]).toMatchObject({ peer: bob.account.accountId, video: true });
    await until(() => invites.length === 1);
    expect(invites[0]).toMatchObject({ callId: join.callId, video: true });
    await bob.client.declineCall(invites[0]!);
    await until(() => remote.includes('decline'));
    expect((await ana.client.callLog()).some((c) => c.callId === join.callId)).toBe(true);
  });

  it('an answered call can be ended and lands in both call logs', async () => {
    await ana.client.openConversation(dto(bob));
    let invite: CallInvite | undefined;
    bob.client.on('call', (event) => { const e = event as { type: string; invite?: CallInvite }; if (e.type === 'incoming') invite = e.invite; });
    const { join } = await ana.client.startCall(bob.account.accountId, false);
    await until(() => !!invite);
    const joined = await bob.client.answerCall(invite!);
    expect(joined.callId).toBe(join.callId);
    await ana.client.endCall(join.callId, bob.account.accountId, true);
    await until(async () => (await bob.client.callLog()).some((c) => c.callId === join.callId));
    await bob.client.clearCallLog();
    expect(await bob.client.callLog()).toEqual([]);
  });

  it('a malformed call ID from the server is refused before ringing', async () => {
    server.handle('createCall', () => ({ callId: 'not-a-uuid', room: 'r', token: 't', path: '/rtc', video: false }));
    await expect(ana.client.startCall(bob.account.accountId, false)).rejects.toThrow('invalid call ID');
    expect(await ana.client.callLog()).toEqual([]);
  });

  it('calls are not offered in notes or channels', async () => {
    const notes = await ana.client.openConversation({ accountId: ana.account.accountId, username: 'ana' });
    await expect(ana.client.startCall(notes.id, false)).rejects.toThrow('calls unavailable here');
  });

  it('an unanswered call is logged as missed', async () => {
    await ana.client.openConversation(dto(bob));
    let invite: CallInvite | undefined;
    bob.client.on('call', (event) => { const e = event as { type: string; invite?: CallInvite }; if (e.type === 'incoming') invite = e.invite; });
    await ana.client.startCall(bob.account.accountId, false);
    await until(() => !!invite);
    await bob.client.missCall(invite!);
    await until(async () => (await bob.client.callLog()).some((c) => c.status === 'missed'));
  });
});
