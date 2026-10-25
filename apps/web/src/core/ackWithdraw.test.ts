import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import type { AckResponse } from '../crypto/content';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { DEFAULT_SETTINGS, type ChatMessage } from './model';
import { Repositories } from './repositories';

/** Specs §30.6: withdrawing an acknowledgement converges regardless of delivery order. */
let store: EncryptedStore; let client: EnclaveClient; let repos: Repositories;
const conversationId = `g:${'C'.repeat(43)}`;
const announcement = { conversationId, id: 'ann', authorId: 'self', direction: 'out', sentAt: 1, sort: 1, reactions: {}, status: 'sent',
  ackRequest: { requestId: 'req', revision: 1, reviewers: ['self'], audience: ['amy'] } } as unknown as ChatMessage;
const ack = (timestamp: number, withdrawn = false): AckResponse => ({ requestId: 'req', requestRevision: 1, conversationId, messageId: 'ann', authorId: 'self',
  contentRevision: 0, timestamp, ...(withdrawn ? { withdrawn: true } : {}) });

async function deliver(response: AckResponse, serverTimestamp: number): Promise<ChatMessage> {
  const ops: unknown[] = [];
  await (client as unknown as { applyAck: (...a: unknown[]) => Promise<void> }).applyAck('amy', response, { serverTimestamp }, ops, new Set());
  await store.commit(ops as never);
  return (await repos.message(conversationId, 'self', 'ann'))!;
}

beforeEach(async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test' } });
  store = await EncryptedStore.open(`ackw-${Math.random()}`);
  repos = new Repositories(store);
  client = new EnclaveClient({ accountId: 'self', deviceId: 1, username: 'self', deploymentId: 'dev', registeredAt: 1, nextPreKeyId: 1 },
    {} as EnclaveApi, repos, new SignalStore(store), DEFAULT_SETTINGS);
  await store.commit([repos.putMessage(announcement)]);
});
afterEach(async () => { vi.unstubAllGlobals(); await store.destroy(); });

it('a withdrawal removes the response; acknowledging again counts again', async () => {
  expect((await deliver(ack(10), 100)).acks?.amy).toBeDefined();
  expect((await deliver(ack(20, true), 200)).acks?.amy).toBeUndefined();
  expect((await deliver(ack(30), 300)).acks?.amy).toMatchObject({ at: 300 });
});

it('an older response delivered after the withdrawal does not count', async () => {
  await deliver(ack(20, true), 200);
  expect((await deliver(ack(10), 150)).acks?.amy).toBeUndefined();
});

it('a stale withdrawal does not remove a newer response', async () => {
  await deliver(ack(30), 300);
  expect((await deliver(ack(20, true), 200)).acks?.amy).toMatchObject({ at: 300 });
});

it('custom reviewers: the publisher plus chosen owners/admins only; default is the owners', () => {
  const group = { community: {}, adminOnly: true, members: [
    { accountId: 'self', role: 'admin' }, { accountId: 'owner', role: 'owner' }, { accountId: 'adm', role: 'admin' }, { accountId: 'm', role: 'member' }] };
  const make = (options: object) => (client as unknown as { newAckRequest: (g: unknown, r: string[], o: object) => { reviewers: string[] } }).newAckRequest(group, ['m'], options);
  expect(make({}).reviewers).toEqual(['self', 'owner']);
  expect(make({ reviewers: ['adm', 'm'] }).reviewers).toEqual(['self', 'adm']); // members cannot review
  expect(make({ reviewers: [] }).reviewers).toEqual(['self']);
});
