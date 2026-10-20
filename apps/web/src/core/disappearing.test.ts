import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import type { EnvelopeDto } from '../api/types';
import type { DataMessage } from '../crypto/content';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore, type StoreOp } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { DEFAULT_SETTINGS, type Conversation } from './model';
import { Outbox } from './outbox';
import { Repositories } from './repositories';
import { mergeArchivedMessage } from './history';
import { expired } from './disappearing';

const DAY = 24 * 3600;
let store: EncryptedStore; let client: EnclaveClient; let repos: Repositories;
const conversation: Conversation = { id: 'peer', title: 'Peer', kind: 'direct', pinned: false, muted: false, archived: false, unread: 0, lastActivity: 1 };
const envelope = (at: number) => ({ guid: `g${Math.random()}`, type: 'CIPHERTEXT', sourceAccount: 'peer', sourceDevice: 1, serverTimestamp: at, expiresAt: 0, urgent: false, content: '' }) as EnvelopeDto;
async function receive(data: DataMessage, at = Date.now()) {
  const ops: StoreOp[] = [];
  const result = await (client as unknown as { applyData: (...a: unknown[]) => Promise<string> }).applyData('peer', 'peer', 'in', data, envelope(at), ops, new Set());
  await store.commit(ops);
  (client as unknown as { conversationCache: Map<string, Conversation> }).conversationCache.forEach(() => undefined);
  return result;
}

beforeEach(async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test' } });
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.spyOn(Outbox.prototype, 'flush').mockResolvedValue();
  store = await EncryptedStore.open(`disappearing-${Math.random()}`);
  repos = new Repositories(store);
  client = new EnclaveClient({ accountId: 'self', deviceId: 1, username: 'self', deploymentId: 'dev', registeredAt: 1, nextPreKeyId: 1 },
    {} as EnclaveApi, repos, new SignalStore(store), DEFAULT_SETTINGS);
  await store.commit([repos.putConversation(conversation)]);
  (client as unknown as { conversationCache: Map<string, Conversation> }).conversationCache.set('peer', conversation);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await store.destroy(); });

it('applies the newest timer, starts received timers on read and sweeps expired messages', async () => {
  expect(await receive({ messageId: 't1', timestamp: 100, timerUpdate: { seconds: 7 * DAY } })).toBe('mutation');
  expect(client.conversations()[0]).toMatchObject({ expireSeconds: 7 * DAY, expireUpdatedAt: 100 });
  expect(await receive({ messageId: 't0', timestamp: 50, timerUpdate: { seconds: DAY } })).toBe('mutation');
  expect(client.conversations()[0]?.expireSeconds).toBe(7 * DAY); // older change does not win
  expect(await receive({ messageId: 'bad', timestamp: 200, timerUpdate: { seconds: 12345 } })).toBe('ignored');

  await receive({ messageId: 'm1', timestamp: 300, body: 'vanishing secret', expireTimer: DAY });
  expect((await repos.message('peer', 'peer', 'm1'))?.expiresAt).toBeUndefined(); // unread: countdown not started
  const before = Date.now();
  await client.markRead('peer');
  const read = await repos.message('peer', 'peer', 'm1');
  expect(read?.expiresAt).toBeGreaterThanOrEqual(before + DAY * 1000);

  await client.sweepExpired(read!.expiresAt! - 1);
  expect(await repos.message('peer', 'peer', 'm1')).toBeDefined();
  await client.sweepExpired(read!.expiresAt!);
  expect(await repos.message('peer', 'peer', 'm1')).toBeUndefined();
  expect(await repos.isLocallyDeleted({ conversationId: 'peer', authorId: 'peer', id: 'm1' } as never)).toBe(true);
  expect(client.conversations()[0]?.preview).not.toContain('vanishing secret');
});

it('never restores an expired message from the archive', () => {
  const message = { conversationId: 'peer', id: 'x', authorId: 'peer', direction: 'in' as const, sentAt: 1, sort: 1, reactions: {}, body: 'old', expireTimer: DAY, expiresAt: 10 };
  expect(expired(message, 11)).toBe(true);
  expect(expired({ ...message, expiresAt: undefined }, 11)).toBe(false);
  expect(mergeArchivedMessage(undefined, message).expiresAt).toBe(10);
});
