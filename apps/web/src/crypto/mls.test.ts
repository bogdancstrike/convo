import { describe, expect, it } from 'vitest';
import { fromUtf8, randomBytes, utf8 } from '../lib/bytes';
import {
  addProposals,
  commit,
  createGroupWith,
  decodeKeyPackageMessage,
  decrypt,
  deserializeState,
  encrypt,
  epochOf,
  generateKeyPackages,
  generateSigner,
  join,
  keyPackageIdentity,
  members,
  processCommit,
  removeProposals,
  serializeState,
  welcomeTargets,
} from './mls';

async function device(account: string) {
  const signer = await generateSigner();
  const kps = await generateKeyPackages(signer, account, 1, 2);
  return { signer, kps };
}

describe('MLS facade', () => {
  it('runs create → welcome → messages with authenticated senders → remove', async () => {
    const alice = await device('alice');
    const bob = await device('bob');
    const carol = await device('carol');
    const bobKp = decodeKeyPackageMessage(bob.kps[0]!.message);
    expect(keyPackageIdentity(bobKp)).toBe('bob.1');

    const created = await createGroupWith(alice.signer, alice.kps[0]!, randomBytes(32), [bobKp]);
    let a = created.state;
    expect(epochOf(a)).toBe(1);
    const target = welcomeTargets(created.welcome!)[0];
    expect(target).toBe(bob.kps[0]!.ref);
    let b = deserializeState(serializeState(await join(created.welcome!, bob.signer, bob.kps[0]!)));

    const sent = await encrypt(a, utf8('hello'));
    a = sent.state;
    const got = await decrypt(b, sent.message);
    b = got.state;
    expect(fromUtf8(got.plaintext)).toBe('hello');
    expect(got.sender).toBe('alice.1');

    // Add carol, bob processes the commit; then remove carol.
    const added = await commit(a, addProposals([decodeKeyPackageMessage(carol.kps[0]!.message)]));
    a = added.state;
    b = (await processCommit(b, added.commit!)).state;
    let c = await join(added.welcome!, carol.signer, carol.kps[0]!);
    expect(members(b).map((m) => m.identity).sort()).toEqual(['alice.1', 'bob.1', 'carol.1']);

    const fromBob = await encrypt(b, utf8('hi all'));
    b = fromBob.state;
    const atCarol = await decrypt(c, fromBob.message);
    c = atCarol.state;
    expect(atCarol.sender).toBe('bob.1');

    const carolLeaf = members(a).find((m) => m.identity === 'carol.1')!.leafIndex;
    const removed = await commit(a, removeProposals([carolLeaf]));
    a = removed.state;
    expect((await processCommit(b, removed.commit!)).kind).toBe('applied');
    expect((await processCommit(c, removed.commit!)).kind).toBe('removed');
    expect(epochOf(a)).toBe(3);
  });

  it('decrypts a message from the previous epoch after a commit was processed', async () => {
    const alice = await device('alice');
    const bob = await device('bob');
    const created = await createGroupWith(alice.signer, alice.kps[0]!, randomBytes(32), [decodeKeyPackageMessage(bob.kps[0]!.message)]);
    let a = created.state;
    let b = await join(created.welcome!, bob.signer, bob.kps[0]!);
    const late = await encrypt(b, utf8('sent before the commit'));
    b = late.state;
    const update = await commit(a, []);
    a = update.state;
    const result = await decrypt(a, late.message);
    expect(fromUtf8(result.plaintext)).toBe('sent before the commit');
    expect(result.sender).toBe('bob.1');
  });
});
