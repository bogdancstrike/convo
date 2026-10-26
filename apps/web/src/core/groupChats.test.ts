import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import type { ChatMessage } from './model';

/**
 * MLS groups between three real clients over the in-memory server: creation with welcomes,
 * messages, membership and role commits, channels and leaving.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let cara: TestDevice;

const dto = (d: TestDevice) => ({ accountId: d.account.accountId, username: d.account.username, displayName: d.account.displayName });
const conversation = (d: TestDevice, id: string) => d.client.conversations().find((c) => c.id === id);
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => (await d.client.messages(conversationId)).some(predicate));
  return (await d.client.messages(conversationId)).find(predicate)!;
}
const joined = (d: TestDevice, id: string) => until(() => !!conversation(d, id) && !conversation(d, id)!.left);

beforeEach(async () => {
  server = new FakeServer();
  [ana, bob, cara] = [await server.enroll('ana', 'Ana'), await server.enroll('bob', 'Bob'), await server.enroll('cara', 'Cara')];
  for (const d of [ana, bob, cara]) await d.client.start();
  await until(() => [ana, bob, cara].every((d) => d.connection === 'online'));
  // Key packages are published once each device has its MLS identity.
  await until(() => [ana, bob, cara].every((d) => (server.accounts.get(d.account.accountId)!.devices.get(1)!.keyPackages.length) > 0));
});
afterEach(() => server.close(ana, bob, cara));

describe('groups', () => {
  it('a new group reaches every member through a welcome, and messages flow to all', async () => {
    const group = await ana.client.createGroup('Night shift', [dto(bob), dto(cara)]);
    await joined(bob, group.id); await joined(cara, group.id);
    // The name travels encrypted after the welcome.
    await until(() => conversation(bob, group.id)?.title === 'Night shift');
    await ana.client.sendText(group.id, 'hello team');
    await see(bob, group.id, (m) => m.body === 'hello team');
    await see(cara, group.id, (m) => m.body === 'hello team');
    await bob.client.sendText(group.id, 'hi Ana');
    await see(ana, group.id, (m) => m.body === 'hi Ana');
    await see(cara, group.id, (m) => m.body === 'hi Ana');
  });

  it('the server sees only ciphertext and group metadata', async () => {
    const group = await ana.client.createGroup('Secret club', [dto(bob)]);
    await joined(bob, group.id);
    bob.client.stop();
    await ana.client.sendText(group.id, 'the password is swordfish');
    await until(() => server.mailbox(bob.account).some((e) => e.type === 'MLS_PRIVATE'));
    const stored = JSON.stringify(server.mailbox(bob.account));
    expect(stored).not.toContain('swordfish');
    expect(stored).not.toContain('Secret club');
  });

  it('the creator is owner; roles reach the other members', async () => {
    const group = await ana.client.createGroup('Team', [dto(bob), dto(cara)]);
    await joined(bob, group.id);
    const record = await ana.client.groupRecord(group.id);
    expect(record?.members.find((m) => m.accountId === ana.account.accountId)?.role).toBe('owner');
    await ana.client.changeGroupRole(group.id, bob.account.accountId, 'admin');
    await until(async () => (await bob.client.groupRecord(group.id))?.members.find((m) => m.accountId === bob.account.accountId)?.role === 'admin');
  });

  it('adding a member lets them read new messages only', async () => {
    const group = await ana.client.createGroup('Growing', [dto(bob)]);
    await joined(bob, group.id);
    await ana.client.sendText(group.id, 'before cara');
    await see(bob, group.id, (m) => m.body === 'before cara');
    await ana.client.addGroupMembers(group.id, [cara.account.accountId]);
    await joined(cara, group.id);
    await ana.client.sendText(group.id, 'welcome cara');
    await see(cara, group.id, (m) => m.body === 'welcome cara');
    expect((await cara.client.messages(group.id)).some((m) => m.body === 'before cara')).toBe(false);
  });

  it('a removed member stops receiving messages', async () => {
    const group = await ana.client.createGroup('Shrinking', [dto(bob), dto(cara)]);
    await joined(bob, group.id); await joined(cara, group.id);
    await ana.client.removeGroupMember(group.id, cara.account.accountId);
    await until(() => !!conversation(cara, group.id)?.left);
    await ana.client.sendText(group.id, 'only for bob');
    await see(bob, group.id, (m) => m.body === 'only for bob');
    await new Promise((r) => setTimeout(r, 200));
    expect((await cara.client.messages(group.id)).some((m) => m.body === 'only for bob')).toBe(false);
  });

  it('members cannot manage membership', async () => {
    const group = await ana.client.createGroup('Rules', [dto(bob)]);
    await joined(bob, group.id);
    await expect(bob.client.addGroupMembers(group.id, [cara.account.accountId])).rejects.toThrow();
    await expect(bob.client.changeGroupRole(group.id, ana.account.accountId, 'member')).rejects.toThrow();
  });

  it('renaming a group updates everyone', async () => {
    const group = await ana.client.createGroup('Old name', [dto(bob)]);
    await joined(bob, group.id);
    await ana.client.updateGroupInfo(group.id, { name: 'New name', description: 'about us' });
    await until(() => conversation(bob, group.id)?.title === 'New name');
  });

  it('leaving stops delivery to the leaver; the last owner must hand over first', async () => {
    const group = await ana.client.createGroup('Leavers', [dto(bob), dto(cara)]);
    await joined(bob, group.id); await joined(cara, group.id);
    await expect(ana.client.leaveGroup(group.id)).rejects.toThrow();
    await bob.client.leaveGroup(group.id);
    expect(conversation(bob, group.id)?.left).toBe(true);
    await ana.client.sendText(group.id, 'after bob left');
    await see(cara, group.id, (m) => m.body === 'after bob left');
    await new Promise((r) => setTimeout(r, 200));
    expect((await bob.client.messages(group.id)).some((m) => m.body === 'after bob left')).toBe(false);
  });

  it('in a channel only admins post; members can still react', async () => {
    const channel = await ana.client.createGroup('Announcements', [dto(bob)], true);
    await joined(bob, channel.id);
    await ana.client.sendText(channel.id, 'release on Friday');
    const post = await see(bob, channel.id, (m) => m.body === 'release on Friday');
    await bob.client.sendText(channel.id, 'can I post?');
    await see(bob, channel.id, (m) => m.body === 'can I post?' && m.status === 'failed');
    await bob.client.react(post, '🎉');
    await see(ana, channel.id, (m) => m.body === 'release on Friday' && (m.reactions['🎉'] ?? []).includes(bob.account.accountId));
    expect((await ana.client.messages(channel.id)).some((m) => m.body === 'can I post?')).toBe(false);
  });

  it('group polls collect votes from several members', async () => {
    const group = await ana.client.createGroup('Pollsters', [dto(bob), dto(cara)]);
    await joined(bob, group.id); await joined(cara, group.id);
    await ana.client.sendPoll(group.id, 'Friday drinks?', ['Yes', 'No'], false);
    const pollAtBob = await see(bob, group.id, (m) => m.poll?.question === 'Friday drinks?');
    const pollAtCara = await see(cara, group.id, (m) => m.poll?.question === 'Friday drinks?');
    await bob.client.votePoll(pollAtBob, [pollAtBob.poll!.options[0]!.id]);
    await cara.client.votePoll(pollAtCara, [pollAtCara.poll!.options[1]!.id]);
    await see(ana, group.id, (m) => Object.keys(m.poll?.votes ?? {}).length === 2);
  });

  it('a commit raced by another member is retried on the new epoch', async () => {
    const group = await ana.client.createGroup('Race', [dto(bob)]);
    await joined(bob, group.id);
    await ana.client.changeGroupRole(group.id, bob.account.accountId, 'admin');
    await until(async () => (await bob.client.groupRecord(group.id))?.members.find((m) => m.accountId === bob.account.accountId)?.role === 'admin');
    await Promise.all([
      ana.client.updateGroupInfo(group.id, { name: 'From Ana' }).catch(() => undefined),
      bob.client.addGroupMembers(group.id, [cara.account.accountId]).catch(() => undefined),
    ]);
    await joined(cara, group.id);
    await ana.client.sendText(group.id, 'all in sync');
    await see(cara, group.id, (m) => m.body === 'all in sync');
    await see(bob, group.id, (m) => m.body === 'all in sync');
  });
});
