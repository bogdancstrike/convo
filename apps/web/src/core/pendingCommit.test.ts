import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { commit, createGroupWith, epochOf, generateKeyPackages, generateSigner, serializeState } from '../crypto/mls';
import { randomBytes, toBase64Url } from '../lib/bytes';
import { EncryptedStore } from '../storage/encryptedStore';
import { GroupManager, GroupNs } from './groups';

/** Specs §6: a commit whose response was lost is resolved by submission ID, never forked. */
let store: EncryptedStore;
beforeEach(async () => { store = await EncryptedStore.open(`pc-${Math.random()}`); });
afterEach(async () => { await store.destroy(); });

async function setup(status: () => Promise<unknown>) {
  const signer = await generateSigner();
  const kp = (await generateKeyPackages(signer, 'alice', 1, 1))[0]!;
  const created = await createGroupWith(signer, kp, randomBytes(32), []);
  const groupId = toBase64Url(created.state.groupContext.groupId);
  await store.put(GroupNs.state, groupId, serializeState(created.state));
  await store.put(GroupNs.group, groupId, { groupId, name: 'g', metaVersion: 1, members: [], left: false });
  let submitted = 0;
  const api = {
    groupCommit: async () => { submitted++; throw new NetworkError(new Error('offline')); },
    groupCommitStatus: status,
    group: async () => { throw new NetworkError(new Error('offline')); },
  } as unknown as EnclaveApi;
  const groups = new GroupManager(api, store, { accountId: 'alice', deviceId: 1 });
  const output = await commit(created.state, []);
  const submit = (groups as unknown as { submitCommit: (...a: unknown[]) => Promise<void> }).submitCommit.bind(groups);
  await expect(submit(groupId, created.state, output, {})).rejects.toBeInstanceOf(NetworkError);
  return { base: epochOf(created.state), groups, groupId, submitted: () => submitted, epoch: async () => epochOf((await (groups as unknown as { state: (g: string) => Promise<never> }).state(groupId))) };
}

it('retries the same submission, then keeps the outcome pending; an accepted one is applied', async () => {
  const { base, groups, groupId, submitted, epoch } = await setup(async () => ({ epoch: 2, seq: 1, duplicate: true }));
  expect(submitted()).toBe(3); // first try + 2 retries, same submission
  expect(await epoch()).toBe(base); // unknown outcome: nothing applied yet
  await groups.resolvePendingCommits();
  expect(await epoch()).toBe(base + 1);
  expect(await store.get(GroupNs.pendingCommit, groupId)).toBeUndefined();
}, 20_000);

it('a commit the server never accepted is discarded', async () => {
  const { base, groups, groupId, epoch } = await setup(async () => { throw new ApiError(404, 'NOT_FOUND', 'commit not accepted'); });
  await groups.resolvePendingCommits();
  expect(await epoch()).toBe(base);
  expect(await store.get(GroupNs.pendingCommit, groupId)).toBeUndefined();
}, 20_000);
