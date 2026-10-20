import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedStore } from '../storage/encryptedStore';
import { AccountHistory, mergeArchivedMessage } from './history';
import { Repositories } from './repositories';
import { toBase64Url, randomBytes } from '../lib/bytes';
import type { ChatMessage, Conversation } from './model';
import type { EnclaveApi } from '../api/enclaveApi';

const message: ChatMessage = { conversationId: 'peer', id: 'one', authorId: 'peer', body: 'private historical content', sentAt: 1, sort: 1, direction: 'in', reactions: {} };
const conversation: Conversation = { id: 'peer', title: 'Friend', kind: 'direct', pinned: false, muted: false, archived: false, unread: 0, lastActivity: 1 };
describe('durable encrypted account history', () => {
  it('restores old messages from the server with the original device offline; retries the same pending entry', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const rows: { seq: number; id: string; ciphertext: string }[] = [];
    let offline = true;
    const api = { putHistory: vi.fn(async (id: string, ciphertext: string) => {
      if (offline) throw new Error('offline');
      if (!rows.some((r) => r.id === id)) rows.push({ seq: rows.length + 1, id, ciphertext });
    }), history: async (after: number) => rows.filter((r) => r.seq > after) } as unknown as EnclaveApi;
    const source = await EncryptedStore.open(`source-${Math.random()}`); const repos = new Repositories(source);
    await source.commit([repos.putConversation(conversation), repos.putMessage(message)]);
    const secret = toBase64Url(randomBytes(32));
    const history = new AccountHistory(api, source, 'self', 'deployment', async () => {}, () => {}, (task) => task());
    await history.start(secret);
    expect((await source.list('history-pending')).length).toBe(2);
    offline = false; await history.sync(); history.stop();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('private historical content');
    const target = await EncryptedStore.open(`target-${Math.random()}`);
    const restored = new AccountHistory(api, target, 'self', 'deployment', async () => {}, () => {}, (task) => task());
    await restored.start(secret); restored.stop();
    expect(await new Repositories(target).messages('peer', 200)).toEqual([message]);
    expect((await new Repositories(target).conversations())[0]?.title).toBe('Friend');
    await source.destroy(); await target.destroy();
  });
  it('does not resurrect deleted/older edited text or regress delivery receipts', () => {
    const edited = { ...message, body: 'edited', editedAt: 5, status: 'read' as const };
    expect(mergeArchivedMessage(edited, message).body).toBe('edited');
    expect(mergeArchivedMessage(edited, { ...message, status: 'sent' }).status).toBe('read');
    const deleted = { ...message, body: undefined, deleted: true };
    expect(mergeArchivedMessage(deleted, message).deleted).toBe(true);
    expect(mergeArchivedMessage(message, deleted).body).toBeUndefined();
  });
});

it('merges receipt details from concurrent devices without losing recipients or regressing times', () => {
  const first = { ...message, receipts: { a: { deliveredAt: 20, readAt: 40 } }, recipientAccountIds: ['a', 'b'] };
  const second = { ...message, receipts: { a: { deliveredAt: 10 }, b: { deliveredAt: 30 } } };
  const merged = mergeArchivedMessage(first, second);
  expect(merged.receipts).toEqual({ a: { deliveredAt: 20, readAt: 40 }, b: { deliveredAt: 30 } });
  expect(merged.recipientAccountIds).toEqual(['a', 'b']);
});

it('never resurrects a locally deleted message when a delayed archive update replays', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  const rows: { seq: number; id: string; ciphertext: string }[] = [];
  const api = { putHistory: async (id: string, ciphertext: string) => { if (!rows.some((r) => r.id === id)) rows.push({ seq: rows.length + 1, id, ciphertext }); }, history: async (after: number) => rows.filter((r) => r.seq > after) } as unknown as EnclaveApi;
  const source = await EncryptedStore.open(`deletion-${Math.random()}`); const repos = new Repositories(source);
  await source.commit([repos.putConversation(conversation), repos.putMessage(message)]);
  const secret = toBase64Url(randomBytes(32)); const history = new AccountHistory(api, source, 'self', 'deployment', async () => {}, () => {}, (task) => task());
  await history.start(secret);
  // A star/edit archive event is queued before a local-only deletion, then arrives afterward.
  await source.commit([repos.putMessage({ ...message, starred: true })]);
  await source.commit(repos.localDeletion(message));
  await history.sync(); history.stop();
  expect(await repos.messages('peer', 100)).toEqual([]);
  expect(await repos.isLocallyDeleted(message)).toBe(true);
  // Suppression is per message, never a time watermark that could discard an unseen message.
  const next = { ...message, id: 'new-unseen', body: 'must still arrive' };
  expect(await repos.isLocallyDeleted(next)).toBeUndefined();
  await source.destroy();
});
