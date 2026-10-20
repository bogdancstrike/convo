import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import type { EnvelopeDto } from '../api/types';
import { CONTENT_VERSION, type DataMessage } from '../crypto/content';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore, type StoreOp } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { DEFAULT_SETTINGS, type ChatMessage, type Conversation } from './model';
import { Outbox, type OutboxItem } from './outbox';
import { Repositories } from './repositories';

const MIN = 60_000;
let store: EncryptedStore;
let client: EnclaveClient;
let repos: Repositories;
const conversation: Conversation = { id: 'peer', title: 'Peer', kind: 'direct', pinned: false, muted: false, archived: false, unread: 0, lastActivity: 5_000, preview: 'Meeting at 10' };
const original: ChatMessage = { conversationId: 'peer', id: 'm1', authorId: 'peer', direction: 'in', body: 'Meeting at 10', sentAt: 900, sort: 1_000, serverAt: 1_000, reactions: {} };
const envelope = (serverTimestamp: number) => ({ guid: 'g', type: 'CIPHERTEXT', sourceAccount: 'peer', sourceDevice: 1, serverTimestamp, expiresAt: 0, urgent: false, content: '' }) as EnvelopeDto;
const edit = (body: string, revision?: number): DataMessage => ({ messageId: `e${Math.random()}`, timestamp: 2_000, edit: { targetMessageId: 'm1', body, revision } });

async function receive(data: DataMessage, at: number) {
  const ops: StoreOp[] = [];
  const result = await (client as unknown as { applyData: (...args: unknown[]) => Promise<string> }).applyData('peer', 'peer', 'in', data, envelope(at), ops, new Set());
  await store.commit(ops);
  return result;
}

beforeEach(async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test' } });
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.spyOn(Outbox.prototype, 'flush').mockResolvedValue();
  store = await EncryptedStore.open(`edit-receive-${Math.random()}`);
  repos = new Repositories(store);
  client = new EnclaveClient({ accountId: 'self', deviceId: 1, username: 'self', deploymentId: 'dev', registeredAt: 1, nextPreKeyId: 1 },
    {} as EnclaveApi, repos, new SignalStore(store), { ...DEFAULT_SETTINGS, readReceipts: true });
  await store.commit([repos.putConversation(conversation), repos.putMessage(original)]);
  (client as unknown as { conversationCache: Map<string, Conversation> }).conversationCache.set('peer', conversation);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await store.destroy(); });

it('applies edits inside the server-time window and ignores late, stale or replayed ones', async () => {
  expect(await receive(edit('Meeting at 11', 1), 1_000 + 19 * MIN)).toBe('edited');
  expect(await repos.message('peer', 'peer', 'm1')).toMatchObject({ body: 'Meeting at 11', revision: 1, editedAt: 2_000 });
  expect(client.conversations()[0]).toMatchObject({ preview: 'Meeting at 11', unread: 0 });
  expect(await receive(edit('rolled back', 1), 1_000 + 2 * MIN)).toBe('ignored');
  expect(await receive(edit('too late', 2), 1_000 + 21 * MIN)).toBe('ignored');
  expect((await repos.message('peer', 'peer', 'm1'))?.body).toBe('Meeting at 11');
});

it('acknowledges the edited revision, and asks for a read receipt later when the chat is not on screen', async () => {
  await receive(edit('Meeting at 11', 1), 2 * MIN);
  expect((await client.conversations())[0]?.revisedUnread).toEqual([{ authorId: 'peer', id: 'm1' }]);
  await client.markRead('peer');
  const receipts = (await store.list<OutboxItem>('outbox')).map((i) => i.content).filter((c) => c.kind === 'receipt');
  expect(receipts).toContainEqual(expect.objectContaining({ receipt: expect.objectContaining({ type: 'read', messageIds: ['m1'], revisions: [1] }) }));
  expect(client.conversations()[0]?.revisedUnread).toBeUndefined();
});

it('ignores receipts for an older revision of an own edited message', async () => {
  const own: ChatMessage = { ...original, id: 'o1', authorId: 'self', direction: 'out', status: 'sent', recipientAccountIds: ['peer'], revision: 1 };
  await store.commit([repos.putMessage(own)]);
  const apply = (client as unknown as { applyContent: (...args: unknown[]) => Promise<unknown> }).applyContent.bind(client);
  const receiptOps = async (revisions?: number[]) => {
    const ops: StoreOp[] = [];
    await apply(envelope(5_000), { v: CONTENT_VERSION, kind: 'receipt', receipt: { type: 'delivery', messageIds: ['o1'], timestamp: 1, revisions } }, ops, new Set());
    await store.commit(ops);
  };
  await receiptOps();
  expect((await repos.message('peer', 'self', 'o1'))?.status).toBe('sent');
  await receiptOps([1]);
  expect((await repos.message('peer', 'self', 'o1'))?.status).toBe('delivered');
});
