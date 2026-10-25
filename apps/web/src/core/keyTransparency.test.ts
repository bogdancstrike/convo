import { expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { readFileSync } from 'node:fs';
import { fromBase64Url, toBase64Url } from '../lib/bytes';
import { cosignedBytes, deviceHash, headBytes, leafBytes, leafHash, verifyAccount, verifyConsistency, verifyInclusion, type KtAccountProof } from './keyTransparency';

const V = JSON.parse(readFileSync(new URL('../../../../contracts/vectors/kt-v1.json', import.meta.url), 'utf8'));
const b = (s: string) => fromBase64Url(s);

it('encodings match the shared vectors', () => {
  for (const e of V.entries) {
    const dh = deviceHash(e.devices);
    expect(toBase64Url(dh)).toBe(e.deviceHash);
    const leaf = leafBytes(e.accountId, e.deviceListVersion, b(e.identityKey), dh);
    expect(toBase64Url(leaf)).toBe(e.leaf);
    expect(toBase64Url(leafHash(leaf))).toBe(e.leafHash);
  }
  const h = V.head;
  expect(toBase64Url(headBytes(h.deploymentId, h.size, b(h.root), h.timestamp))).toBe(h.bytes);
  expect(toBase64Url(cosignedBytes(b(h.bytes), h.cosignTimestamp))).toBe(h.cosignBytes);
});

it('accepts every vector proof and rejects tampered ones', () => {
  const leaves = V.entries.map((e: { leafHash: string }) => b(e.leafHash));
  for (const p of V.inclusion) {
    expect(verifyInclusion(p.index, p.size, leaves[p.index], p.path.map(b), b(V.roots[String(p.size)]))).toBe(true);
    expect(verifyInclusion(p.index, p.size, leaves[(p.index + 1) % p.size], p.path.map(b), b(V.roots[String(p.size)]))).toBe(p.size === 1);
  }
  for (const p of V.consistency) {
    expect(verifyConsistency(p.from, p.to, b(V.roots[String(p.from)]), b(V.roots[String(p.to)]), p.proof.map(b))).toBe(true);
    // The proof must not verify against any other new root.
    if (p.from < p.to) expect(verifyConsistency(p.from, p.to, b(V.roots[String(p.from)]), b(V.roots[String(p.to - 1)]), p.proof.map(b))).toBe(false);
  }
});

/** A small log built with the vector entries, signed by a test log key and one witness. */
function fixture(witnessed = true) {
  const logPriv = ed25519.utils.randomSecretKey(), witnessPriv = ed25519.utils.randomSecretKey();
  const size = 7, root = b(V.roots['7']), now = Date.now();
  const sign = (bytes: Uint8Array) => toBase64Url(ed25519.sign(bytes, logPriv));
  const head = { deploymentId: 'd', size, root: V.roots['7'], timestamp: now, signature: sign(headBytes('d', size, root, now)), logKey: toBase64Url(ed25519.getPublicKey(logPriv)) };
  const e = V.entries[3];
  const inc = V.inclusion.find((p: { index: number; size: number }) => p.index === 3 && p.size === 7);
  const proof: KtAccountProof = {
    head, witnessConsistency: [], sinceConsistency: [], inclusion: inc.path, maxWitnessAgeMs: 86_400_000,
    leaf: { index: 3, accountId: e.accountId, identityKey: e.identityKey, deviceListVersion: e.deviceListVersion, deviceHash: e.deviceHash },
    witnesses: { w1: toBase64Url(ed25519.getPublicKey(witnessPriv)) },
    witnessed: witnessed ? { head, cosignatures: [{ witnessId: 'w1', publicKey: toBase64Url(ed25519.getPublicKey(witnessPriv)), timestamp: now, signature: toBase64Url(ed25519.sign(cosignedBytes(headBytes('d', size, root, now), now), witnessPriv)) }] } : null,
  };
  const expected = { accountId: e.accountId, identityKey: e.identityKey, roster: { deviceListVersion: e.deviceListVersion, devices: e.devices } };
  return { proof, expected, now };
}

it('verifies a witnessed entry and pins keys', () => {
  const { proof, expected, now } = fixture();
  const r = verifyAccount(proof, expected, 'd', {}, now);
  expect(r.status).toBe('verified');
  expect(r.state).toMatchObject({ logKey: proof.head.logKey, last: { size: 7 } });
  expect(verifyAccount(fixture(false).proof, fixture(false).expected, 'd', {}, now).status).toBe('unwitnessed');
});

it('detects substituted keys, devices, rollback and a changed log key', () => {
  const { proof, expected, now } = fixture();
  expect(verifyAccount(proof, { ...expected, identityKey: V.entries[0].identityKey }, 'd', {}, now)).toMatchObject({ status: 'mismatch', reason: 'identity-key' });
  expect(verifyAccount(proof, { ...expected, roster: { ...expected.roster, devices: [...expected.roster.devices, { deviceId: 9, registrationId: 1 }] } }, 'd', {}, now)).toMatchObject({ status: 'mismatch', reason: 'devices' });
  expect(verifyAccount(proof, expected, 'd', { last: { size: 9, root: V.roots['7'] } }, now)).toMatchObject({ status: 'log-error', reason: 'rollback' });
  expect(verifyAccount(proof, expected, 'd', { logKey: 'other' }, now)).toMatchObject({ status: 'log-error', reason: 'log-key-changed' });
  expect(verifyAccount({ ...proof, head: { ...proof.head, root: V.roots['6'] } }, expected, 'd', {}, now)).toMatchObject({ status: 'log-error', reason: 'bad-head-signature' });
  // A fork: same size as before but a different root.
  expect(verifyAccount(proof, expected, 'd', { last: { size: 7, root: V.roots['6'] } }, now)).toMatchObject({ status: 'log-error', reason: 'inconsistent' });
});

it('treats an old co-signature as unwitnessed', () => {
  const { proof, expected, now } = fixture();
  expect(verifyAccount(proof, expected, 'd', {}, now + 2 * 86_400_000).status).toBe('unwitnessed');
});

it('ignores co-signatures by witnesses the device did not pin', () => {
  const { proof, expected, now } = fixture();
  expect(verifyAccount(proof, expected, 'd', { witnesses: { other: 'AAAA' } }, now).status).toBe('unwitnessed');
});

const M = JSON.parse(readFileSync(new URL('../../../../contracts/vectors/kt-map-v1.json', import.meta.url), 'utf8'));

it('verifiable map: keys and proofs match the shared vectors; wrong values do not', async () => {
  const { mapKey, mapRootFromProof } = await import('./keyTransparency');
  for (const p of M.proofs) {
    expect(toBase64Url(mapKey(p.accountId))).toBe(p.key);
    const implied = mapRootFromProof(b(p.key), p.value ? b(p.value) : null, b(p.bitmap), p.siblings.map(b));
    expect(toBase64Url(implied!)).toBe(M.root);
    // An older value, or claiming absence for a present key (or presence for an absent one), fails.
    const forged = mapRootFromProof(b(p.key), p.value ? null : b(M.entries[0].value), b(p.bitmap), p.siblings.map(b));
    expect(toBase64Url(forged!)).not.toBe(M.root);
  }
});

it('with the map, an older (still included) entry is rejected and the newest one verifies', async () => {
  const { mapHeadBytes } = await import('./keyTransparency');
  const logPriv = ed25519.utils.randomSecretKey(), now = Date.now();
  const root7 = b(V.roots['7']);
  const head = { deploymentId: 'd', size: 7, root: V.roots['7'], timestamp: now, signature: toBase64Url(ed25519.sign(headBytes('d', 7, root7, now), logPriv)),
    logKey: toBase64Url(ed25519.getPublicKey(logPriv)), mapRoot: M.root, mapSignature: toBase64Url(ed25519.sign(mapHeadBytes('d', 7, b(M.root), now), logPriv)) };
  const proofFor = (index: number): KtAccountProof => {
    const e = V.entries[index];
    const mp = M.proofs.find((p: { accountId: string }) => p.accountId === e.accountId);
    return { head, witnessed: null, witnessConsistency: [], sinceConsistency: [], maxWitnessAgeMs: 1, witnesses: {},
      leaf: { index, accountId: e.accountId, identityKey: e.identityKey, deviceListVersion: e.deviceListVersion, deviceHash: e.deviceHash },
      inclusion: V.inclusion.find((p: { index: number; size: number }) => p.index === index && p.size === 7).path, mapProof: { bitmap: mp.bitmap, siblings: mp.siblings } };
  };
  const expect0 = { accountId: V.entries[0].accountId, identityKey: V.entries[0].identityKey, roster: { deviceListVersion: V.entries[0].deviceListVersion, devices: V.entries[0].devices } };
  expect(verifyAccount(proofFor(0), expect0, 'd', {}, now)).toMatchObject({ status: 'unwitnessed', state: { mapSeen: true } });
  const e3 = V.entries[3];
  expect(verifyAccount(proofFor(3), { accountId: e3.accountId, identityKey: e3.identityKey, roster: { deviceListVersion: e3.deviceListVersion, devices: e3.devices } }, 'd', {}, now))
    .toMatchObject({ status: 'log-error', reason: 'not-newest' });
  // A server that drops the map after a device saw one is a downgrade.
  const { mapRoot: _r, mapSignature: _s, ...plain } = head;
  expect(verifyAccount({ ...proofFor(0), head: plain, mapProof: null }, expect0, 'd', { mapSeen: true }, now)).toMatchObject({ status: 'log-error', reason: 'map-missing' });
});
