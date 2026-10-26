import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';

/**
 * Two real clients (Signal sessions, encrypted stores) talking through the in-memory server:
 * the 1:1 messaging contract end to end, without a browser.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;

const bodies = async (d: TestDevice, conversationId: string) => (await d.client.messages(conversationId)).map((m) => m.body);
const received = (d: TestDevice, conversationId: string, body: string) => until(async () => (await bodies(d, conversationId)).includes(body));

beforeEach(async () => {
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  await ana.client.start();
  await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
});
afterEach(() => server.close(ana, bob));

describe('1:1 conversation', () => {
  it('a first message builds a session from a claimed prekey and arrives decrypted', async () => {
    await ana.client.openConversation({ accountId: bob.account.accountId, username: 'bob', displayName: 'Bob Ionescu' });
    await ana.client.sendText(bob.account.accountId, 'Hello Bob');
    await received(bob, ana.account.accountId, 'Hello Bob');
    expect(server.calls).toContain('claimKeys');
    const conversation = bob.client.conversations().find((c) => c.id === ana.account.accountId);
    expect(conversation).toMatchObject({ kind: 'direct', unread: 1, preview: 'Hello Bob' });
  });

  it('replies flow both ways over the established session', async () => {
    await ana.client.sendText(bob.account.accountId, 'ping');
    await received(bob, ana.account.accountId, 'ping');
    await bob.client.sendText(ana.account.accountId, 'pong');
    await received(ana, bob.account.accountId, 'pong');
    expect(await bodies(ana, bob.account.accountId)).toEqual(['ping', 'pong']);
  });

  it('the server only ever stores ciphertext', async () => {
    bob.client.stop();
    await ana.client.sendText(bob.account.accountId, 'a secret plan');
    await until(() => server.mailbox(bob.account).length === 1);
    expect(JSON.stringify(server.mailbox(bob.account))).not.toContain('secret');
  });

  it('messages sent while the recipient is offline arrive when it connects, then leave the mailbox', async () => {
    bob.client.stop();
    await ana.client.sendText(bob.account.accountId, 'one');
    await ana.client.sendText(bob.account.accountId, 'two');
    await until(() => server.mailbox(bob.account).length === 2);
    await bob.client.start();
    await received(bob, ana.account.accountId, 'two');
    expect(await bodies(bob, ana.account.accountId)).toEqual(['one', 'two']);
    await until(() => server.mailbox(bob.account).length === 0);
  });

  it('delivery receipts always update the sender', async () => {
    await ana.client.sendText(bob.account.accountId, 'did you get this?');
    await received(bob, ana.account.accountId, 'did you get this?');
    await until(async () => (await ana.client.messages(bob.account.accountId))[0]?.status === 'delivered');
  });

  it('read receipts are sent only when both sides allow them', async () => {
    await ana.client.updateSettings({ readReceipts: true });
    await ana.client.sendText(bob.account.accountId, 'seen?');
    await received(bob, ana.account.accountId, 'seen?');
    await bob.client.setActiveConversation(ana.account.accountId);
    await new Promise((r) => setTimeout(r, 300));
    expect((await ana.client.messages(bob.account.accountId))[0]?.status).toBe('delivered');
    expect(bob.client.conversations().find((c) => c.id === ana.account.accountId)?.unread).toBe(0);

    await bob.client.updateSettings({ readReceipts: true });
    await bob.client.acceptRequest(ana.account.accountId);
    await ana.client.sendText(bob.account.accountId, 'and now?');
    await received(bob, ana.account.accountId, 'and now?');
    await bob.client.markRead(ana.account.accountId);
    await until(async () => (await ana.client.messages(bob.account.accountId)).at(-1)?.status === 'read');
  });

  it('an outgoing message is stored locally first, then marked sent', async () => {
    await ana.client.sendText(bob.account.accountId, 'local first');
    const [mine] = await ana.client.messages(bob.account.accountId);
    expect(mine).toMatchObject({ direction: 'out', body: 'local first' });
    await until(async () => ['sent', 'delivered', 'read'].includes((await ana.client.messages(bob.account.accountId))[0]?.status ?? ''));
  });
});
