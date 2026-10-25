import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import type { EnvelopeDto } from '../api/types';
import { commit, createGroupWith, decodeKeyPackageMessage, epochOf, generateKeyPackages, generateSigner, join, serializeState } from '../crypto/mls';
import { randomBytes, toBase64Url } from '../lib/bytes';
import { EncryptedStore } from '../storage/encryptedStore';
import { GroupManager, GroupNs } from './groups';

/** Specs §6 catch-up: a device that missed commits replays the accepted ones before the next. */
let store: EncryptedStore;
beforeEach(async () => { store = await EncryptedStore.open(`cu-${Math.random()}`); });
afterEach(async () => { await store.destroy(); });

it('replays a missed commit from the event log, then applies the new one', async () => {
  const alice = await generateSigner(); const bob = await generateSigner();
  const aliceKp = (await generateKeyPackages(alice, 'alice', 1, 1))[0]!;
  const bobKp = (await generateKeyPackages(bob, 'bob', 1, 1))[0]!;
  const created = await createGroupWith(alice, aliceKp, randomBytes(32), [decodeKeyPackageMessage(bobKp.message)]);
  const groupId = toBase64Url(created.state.groupContext.groupId);
  const bobState = await join(created.welcome!, bob, bobKp);
  await store.put(GroupNs.state, groupId, serializeState(bobState));
  await store.put(GroupNs.group, groupId, { groupId, name: 'g', metaVersion: 1, members: [], left: false });

  const first = await commit(created.state, []);   // Bob never receives this one
  const second = await commit(first.state, []);
  const events = [{ seq: 1, epoch: epochOf(created.state), commit: first.commit! }, { seq: 2, epoch: epochOf(first.state), commit: second.commit! }];
  const api = { groupEvents: async (_g: string, from: number) => events.filter((e) => e.epoch >= from) } as unknown as EnclaveApi;
  const groups = new GroupManager(api, store, { accountId: 'bob', deviceId: 1 });

  const envelope = { type: 'MLS_COMMIT', groupId, epoch: epochOf(first.state), content: second.commit! } as unknown as EnvelopeDto;
  const result = await groups.process(envelope);
  await store.commit(result!.ops);
  const state = await (groups as unknown as { state: (g: string) => Promise<Parameters<typeof epochOf>[0]> }).state(groupId);
  expect(epochOf(state)).toBe(epochOf(second.state));
});
