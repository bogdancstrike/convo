import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { DEFAULT_SETTINGS, type Conversation } from './model';
import { Repositories } from './repositories';

let store: EncryptedStore; let client: EnclaveClient;
const group: Conversation = { id: 'g:abc', title: 'Team', kind: 'group', pinned: false, muted: false, archived: false, unread: 0, lastActivity: 1, notify: 'mentions' };
const alert = (mentions?: string[]) => (client as unknown as { emitAlert: (c: string, a: string, d: unknown) => void }).emitAlert('g:abc', 'peer', { messageId: 'm', timestamp: 1, body: 'hi', mentions });

beforeEach(async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test' } });
  store = await EncryptedStore.open(`alerts-${Math.random()}`);
  client = new EnclaveClient({ accountId: 'self', deviceId: 1, username: 'self', deploymentId: 'dev', registeredAt: 1, nextPreKeyId: 1 },
    {} as EnclaveApi, new Repositories(store), new SignalStore(store), DEFAULT_SETTINGS);
  (client as unknown as { conversationCache: Map<string, Conversation> }).conversationCache.set(group.id, group);
});
afterEach(async () => { vi.unstubAllGlobals(); await store.destroy(); });

it('"mentions only" groups alert just for structured mentions of this account; muted chats never alert', () => {
  const seen: boolean[] = [];
  client.on('alert', (a) => seen.push(a.mention));
  alert(); alert(['other']); alert(['self']);
  expect(seen).toEqual([true]);
  (client as unknown as { conversationCache: Map<string, Conversation> }).conversationCache.set(group.id, { ...group, notify: undefined, muted: true });
  alert(['self']);
  expect(seen).toEqual([true]);
});

it('quiet sends never alert, even for a mention', () => {
  const seen: boolean[] = [];
  client.on('alert', (a) => seen.push(a.mention));
  (client as unknown as { emitAlert: (c: string, a: string, d: unknown) => void }).emitAlert('g:abc', 'peer', { messageId: 'q', timestamp: 1, body: 'shh', mentions: ['self'], silent: true });
  expect(seen).toEqual([]);
});

it('scheduled messages: schedule, edit, cancel, and send only once when due', async () => {
  const sent: unknown[] = [];
  (client as unknown as { sendMessage: (c: string, content: unknown) => Promise<void> }).sendMessage = async (_c, content) => { sent.push(content); };
  const now = Date.now();
  await expect(client.scheduleMessage(group.id, 'too late', now - 1000)).rejects.toThrow();
  const a = await client.scheduleMessage(group.id, 'first', now + 60_000);
  const b = await client.scheduleMessage(group.id, 'second', now + 120_000, { silent: true });
  await client.editScheduled(a.id, { body: 'first (edited)' });
  expect((await client.scheduledMessages(group.id)).map((s) => s.body)).toEqual(['first (edited)', 'second']);
  await client.cancelScheduled(b.id);
  await client.sendDueScheduled(now + 30_000);
  expect(sent).toEqual([]);
  await client.sendDueScheduled(now + 61_000);
  await client.sendDueScheduled(now + 62_000);
  expect(sent).toEqual([{ body: 'first (edited)', quote: undefined, mentions: undefined, silent: undefined }]);
  expect(await client.scheduledMessages()).toEqual([]);
});

it('event reminders: scheduled for Going, removed for No, emitted once when due', async () => {
  (client as unknown as { enqueue: (...a: unknown[]) => Promise<void> }).enqueue = async (...args) => { await store.commit(args[4] as never); };
  const now = Date.now();
  const start = now + 3_600_000;
  const target = { conversationId: group.id, id: 'ev', authorId: 'peer', direction: 'in', sentAt: now, sort: now, reactions: {}, status: 'delivered',
    event: { title: 'Hike', start, zone: 'UTC', revision: 0, rsvps: {} } } as unknown as Parameters<EnclaveClient['rsvp']>[0];
  const fired: string[] = [];
  client.on('reminder', (r) => fired.push(r.title));
  await client.rsvp(target, 'no');
  await client.sweepReminders(start - 1);
  expect(fired).toEqual([]);
  await client.rsvp(target, 'going');
  await client.sweepReminders(start - 20 * 60_000); // before the 15-minute lead
  expect(fired).toEqual([]);
  await client.sweepReminders(start - 10 * 60_000);
  await client.sweepReminders(start - 5 * 60_000);
  expect(fired).toEqual(['Hike']);
});
