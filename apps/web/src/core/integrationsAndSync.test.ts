import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';
import type { ChatMessage } from './model';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

/**
 * Addressed-only bots and visible integrations, group topics, own-device sync of settings and
 * folders, safety-number verification and profiles — between real clients.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let extra: TestDevice[] = [];

const dto = (d: TestDevice) => ({ accountId: d.account.accountId, username: d.account.username, displayName: d.account.displayName });
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => (await d.client.messages(conversationId)).some(predicate));
  return (await d.client.messages(conversationId)).find(predicate)!;
}
async function started(d: TestDevice): Promise<TestDevice> {
  extra.push(d); await d.client.start(); await until(() => d.connection === 'online'); return d;
}

beforeEach(async () => {
  extra = [];
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  await until(() => server.accounts.get(bob.account.accountId)!.devices.get(1)!.keyPackages.length > 0);
});
afterEach(() => server.close(ana, bob, ...extra));

describe('addressed-only bots', () => {
  it('a connected bot gets only the messages that mention it, and its answer is relayed into the group', async () => {
    const bot = await started(await server.enroll('helpbot', 'Help Bot'));
    server.accounts.get(bot.account.accountId)!.integration = { kind: 'bot', retention: 'Deleted after 30 days.' };
    const group = await ana.client.createGroup('Support', [dto(bob)]);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    await ana.client.setConnectedBot(group.id, bot.account.accountId, true);
    expect((await ana.client.connectedBots(group.id)).map((b) => b.accountId)).toEqual([bot.account.accountId]);
    await until(async () => (await bob.client.connectedBots(group.id)).length === 1);
    expect(await bob.client.integrationParticipants(group.id)).toContainEqual(expect.objectContaining({ accountId: bot.account.accountId, kind: 'bot', addressedOnly: true }));

    await bob.client.sendText(group.id, 'hello everyone');
    await bob.client.sendText(group.id, '@Help Bot how do I reset my password?', undefined, [bot.account.accountId]);
    const request = await see(bot, bob.account.accountId, (m) => !!m.botRequest);
    expect(request.body).toContain('reset my password');
    expect((await bot.client.messages(bob.account.accountId)).some((m) => m.body === 'hello everyone')).toBe(false);

    await bot.client.sendBotReply(bob.account.accountId, 'Use Settings → Security.', { groupId: request.botRequest!.groupId, messageId: request.botRequest!.messageId });
    const relayed = await see(ana, group.id, (m) => m.body === 'Use Settings → Security.');
    expect((relayed as unknown as { botRelay?: { botId: string } }).botRelay?.botId).toBe(bot.account.accountId);
  });

  it('only bot accounts can be connected, by owners and admins', async () => {
    const group = await ana.client.createGroup('Plain', [dto(bob)]);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    await expect(ana.client.setConnectedBot(group.id, bob.account.accountId, true)).rejects.toThrow('only bot accounts');
    const bot = await server.enroll('anotherbot', 'Another Bot');
    extra.push(bot);
    server.accounts.get(bot.account.accountId)!.integration = { kind: 'bot', retention: '' };
    await expect(bob.client.setConnectedBot(group.id, bot.account.accountId, true)).rejects.toThrow('only owners and admins');
  });

  it('an archive member is disclosed to everyone in the chat', async () => {
    const archive = await started(await server.enroll('archive', 'Archive'));
    await until(() => server.accounts.get(archive.account.accountId)!.devices.get(1)!.keyPackages.length > 0);
    server.accounts.get(archive.account.accountId)!.integration = { kind: 'archive', retention: 'Kept 7 years.' };
    const group = await ana.client.createGroup('Regulated', [dto(bob), dto(archive)]);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    await until(async () => (await bob.client.integrationParticipants(group.id)).length === 1);
    expect((await bob.client.integrationParticipants(group.id))[0]).toMatchObject({ kind: 'archive', retention: 'Kept 7 years.' });
  });
});

describe('group topics', () => {
  it('admins create, rename and close topics; members post into them', async () => {
    const group = await ana.client.createGroup('Big team', [dto(bob)]);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    const topic = await ana.client.createTopic(group.id, 'Releases');
    await until(() => (bob.client.conversations().find((c) => c.id === group.id)?.topics ?? []).some((t) => t.id === topic.id));
    await bob.client.sendText(group.id, 'v2 is out', undefined, undefined, false, { topic: topic.id });
    const post = await see(ana, group.id, (m) => m.body === 'v2 is out');
    expect(post.topic).toBe(topic.id);
    await ana.client.updateTopic(group.id, topic.id, { name: 'Shipping', closed: true });
    await until(() => bob.client.conversations().find((c) => c.id === group.id)?.topics?.find((t) => t.id === topic.id)?.name === 'Shipping');
    await expect(bob.client.createTopic(group.id, 'Mine')).rejects.toThrow();
  });
});

describe('own-device sync', () => {
  it('folders and read state follow the account to its other device', async () => {
    const laptop = await started(await server.linkDevice(ana));
    await ana.client.saveFolders([{ id: 'f1', name: 'Work', chats: [], types: ['groups'] } as never]);
    await until(async () => (await laptop.client.folders()).some((f) => f.name === 'Work'));
    await ana.client.openConversation(dto(bob)); await laptop.client.openConversation(dto(bob));
    await bob.client.openConversation(dto(ana));
    await bob.client.sendText(ana.account.accountId, 'read me once');
    await see(laptop, bob.account.accountId, (m) => m.body === 'read me once');
    await see(ana, bob.account.accountId, (m) => m.body === 'read me once');
    await ana.client.markRead(bob.account.accountId);
    await until(() => laptop.client.conversations().find((c) => c.id === bob.account.accountId)?.unread === 0);
  });
});

describe('safety numbers', () => {
  it('a contact can be marked verified and the mark can be removed', async () => {
    await ana.client.openConversation(dto(bob));
    await ana.client.sendText(bob.account.accountId, 'hi');
    await see(bob, ana.account.accountId, (m) => m.body === 'hi');
    const keys = await ana.client.identityKeys(bob.account.accountId);
    expect(keys.remote).toBeTruthy(); expect(keys.verified).toBe(false);
    await ana.client.setVerified(bob.account.accountId, true);
    expect((await ana.client.identityKeys(bob.account.accountId)).verified).toBe(true);
    await ana.client.setVerified(bob.account.accountId, false);
    expect((await ana.client.identityKeys(bob.account.accountId)).verified).toBe(false);
    await ana.client.acknowledgeIdentityChange(bob.account.accountId);
    expect(ana.client.conversations().find((c) => c.id === bob.account.accountId)?.identityChangedAt).toBeUndefined();
  });
});

describe('profiles', () => {
  it('a JPEG photo and status reach contacts; other images are refused', async () => {
    await ana.client.openConversation(dto(bob));
    await ana.client.sendText(bob.account.accountId, 'hi');
    await see(bob, ana.account.accountId, (m) => m.body === 'hi');
    await bob.client.acceptRequest(ana.account.accountId);
    // Profile photos are re-encoded JPEG data URLs (EXIF stripped); anything else is refused.
    await expect(ana.client.updateProfile({ photo: 'data:image/svg+xml;base64,PHN2Zz4=' })).rejects.toThrow('invalid profile');
    const photo = 'data:image/jpeg;base64,' + Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
    await ana.client.updateProfile({ photo, status: 'Busy' });
    await until(() => bob.client.profiles().get(ana.account.accountId)?.status === 'Busy');
    expect(bob.client.profiles().get(ana.account.accountId)?.photo).toBe(photo);
    await ana.client.updateProfile({ photo: undefined });
  });
});
