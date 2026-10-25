import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64Url } from '../lib/bytes';

/**
 * Key transparency verification (specs §19.4, TRUST-01). The server keeps an append-only RFC 9162
 * Merkle log of every account's identity key and device list and signs a tree head on every append;
 * independent witnesses co-sign heads after checking the log only grew. Before trusting the keys it
 * encrypts to, a device checks that the account's newest log entry matches them, that the entry is
 * included in a signed head, and that the head extends both the last head it accepted (no rollback
 * or fork) and the newest witnessed head. Encodings match `contracts/vectors/kt-v1.json`.
 *
 * Limit: a verifiable log (not a prefix tree) cannot prove that no newer entry exists for an account;
 * owner monitoring and witnesses narrow that (see SECURITY.md §7.5).
 */

const te = new TextEncoder();
const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
const u64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v)); return b; };
const u16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('invalid account ID');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export function deviceHash(devices: { deviceId: number; registrationId: number }[]): Uint8Array {
  const sorted = [...devices].sort((a, b) => a.deviceId - b.deviceId);
  return sha256(concat(te.encode('CONVO-KT-DEVICES-V1\n'), ...sorted.flatMap((d) => [u32(d.deviceId), u32(d.registrationId)])));
}
export function leafBytes(accountId: string, deviceListVersion: number, identityKey: Uint8Array, devicesHash: Uint8Array): Uint8Array {
  return concat(te.encode('CONVO-KT-LEAF-V1\n'), uuidBytes(accountId), u64(deviceListVersion), u16(identityKey.length), identityKey, devicesHash);
}
export function headBytes(deploymentId: string, size: number, root: Uint8Array, timestamp: number): Uint8Array {
  return concat(te.encode(`CONVO-KT-HEAD-V1\n${deploymentId}\n`), u64(size), root, u64(timestamp));
}
/** The witness's signing time is part of the co-signature: freshness is judged by it. */
export const cosignedBytes = (head: Uint8Array, cosignedAt: number) => concat(te.encode('CONVO-KT-COSIGN-V1\n'), u64(cosignedAt), head);
export const leafHash = (leaf: Uint8Array) => sha256(concat(Uint8Array.of(0), leaf));
const node = (l: Uint8Array, r: Uint8Array) => sha256(concat(Uint8Array.of(1), l, r));

/** RFC 9162 §2.1.3.2: is `leaf` at `index` included in the tree of `size` leaves with `root`? */
export function verifyInclusion(index: number, size: number, leaf: Uint8Array, path: Uint8Array[], root: Uint8Array): boolean {
  if (index < 0 || index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = node(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else r = node(r, p);
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(r, root);
}

/** RFC 9162 §2.1.4.2: does the tree of size `n` (rootN) extend the tree of size `m` (rootM)? */
export function verifyConsistency(m: number, n: number, rootM: Uint8Array, rootN: Uint8Array, proof: Uint8Array[]): boolean {
  if (m < 1 || m > n) return false;
  if (m === n) return proof.length === 0 && equal(rootM, rootN);
  const nodes = (m & (m - 1)) === 0 ? [rootM, ...proof] : [...proof];
  if (nodes.length === 0) return false;
  let fn = m - 1, sn = n - 1;
  while (fn % 2 === 1) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
  let fr = nodes[0]!, sr = nodes[0]!;
  for (const c of nodes.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = node(c, fr); sr = node(c, sr);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else sr = node(sr, c);
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(fr, rootM) && equal(sr, rootN);
}

// --- verifiable map (sparse Merkle tree: account → newest leaf hash) ------------------------------

const MAP_DEPTH = 256;
const EMPTY: Uint8Array[] = [new Uint8Array(32)];
for (let i = 1; i <= MAP_DEPTH; i++) EMPTY.push(node(EMPTY[i - 1]!, EMPTY[i - 1]!));
const bitAt = (bytes: Uint8Array, i: number) => (bytes[i >> 3]! >> (7 - (i & 7))) & 1;

export const mapKey = (accountId: string) => sha256(concat(te.encode('CONVO-KT-MAPKEY-V1\n'), uuidBytes(accountId)));
export function mapHeadBytes(deploymentId: string, size: number, mapRoot: Uint8Array, timestamp: number): Uint8Array {
  return concat(te.encode(`CONVO-KT-MAP-V1\n${deploymentId}\n`), u64(size), mapRoot, u64(timestamp));
}
export const cosignedV2Bytes = (head: Uint8Array, mapRoot: Uint8Array, cosignedAt: number) => concat(te.encode('CONVO-KT-COSIGN-V2\n'), u64(cosignedAt), head, mapRoot);

/**
 * Root implied by a map proof for `key` holding `value` (null = absent). The proof lists the
 * non-empty siblings top-down, flagged in a 32-byte bitmap; every other sibling is empty.
 */
export function mapRootFromProof(key: Uint8Array, value: Uint8Array | null, bitmap: Uint8Array, siblings: Uint8Array[]): Uint8Array | null {
  if (key.length !== 32 || bitmap.length !== 32) return null;
  const flagged: number[] = [];
  for (let d = 0; d < MAP_DEPTH; d++) if (bitAt(bitmap, d)) flagged.push(d);
  if (flagged.length !== siblings.length) return null;
  const sibling = new Map(flagged.map((d, i) => [d, siblings[i]!]));
  let h = value ? sha256(concat(Uint8Array.of(2), key, value)) : EMPTY[0]!;
  for (let d = MAP_DEPTH - 1; d >= 0; d--) {
    const s = sibling.get(d) ?? EMPTY[MAP_DEPTH - d - 1]!;
    h = bitAt(key, d) ? node(s, h) : node(h, s);
  }
  return h;
}

// --- one account, end to end --------------------------------------------------------------------

export interface KtHead { deploymentId: string; size: number; root: string; timestamp: number; signature: string; logKey: string; mapRoot?: string | null; mapSignature?: string | null }
/** What `GET /v1/kt/accounts/{id}` returns. */
export interface KtAccountProof {
  head: KtHead;
  witnessed: { head: KtHead; cosignatures: { witnessId: string; publicKey: string; timestamp: number; signature: string; version?: number }[] } | null;
  witnessConsistency: string[];
  sinceConsistency: string[];
  leaf: { index: number; accountId: string; identityKey: string; deviceListVersion: number; deviceHash: string } | null;
  inclusion: string[];
  maxWitnessAgeMs: number;
  witnesses: Record<string, string>;
  /** Verifiable-map proof for this account at `head` (null on servers without the map). */
  mapProof?: { bitmap: string; siblings: string[] } | null;
}
/** A tree head as signed by the log: what devices gossip to each other. */
export interface KtSignedHead { size: number; root: string; timestamp: number; signature: string }
/** Device-local trust state: pinned keys and the newest head accepted (signed, for gossip). */
export interface KtState { logKey?: string; witnesses?: Record<string, string>; last?: { size: number; root: string; timestamp?: number; signature?: string }; mapSeen?: boolean }

/** Whether a gossiped head carries a valid signature by the pinned log key. */
export function verifySignedHead(head: KtSignedHead, deploymentId: string, logKey: string): boolean {
  try {
    return Number.isSafeInteger(head.size) && head.size > 0 && Number.isSafeInteger(head.timestamp)
      && ed25519.verify(fromBase64Url(head.signature), headBytes(deploymentId, head.size, fromBase64Url(head.root), head.timestamp), fromBase64Url(logKey));
  } catch { return false; }
}
/**
 * - `verified`: the keys match a log entry included in a head that a pinned witness co-signed recently
 * - `unwitnessed`: the keys match the log, but no fresh co-signature from a pinned witness exists
 * - `stale`: the roster changed between the two requests; check again
 * - `mismatch`: the log says something else about this account's keys (possible attack)
 * - `log-error`: bad signature, changed log key, rollback or fork (possible attack)
 */
export type KtStatus = 'verified' | 'unwitnessed' | 'stale' | 'mismatch' | 'log-error';
export interface KtResult { status: KtStatus; reason?: string; state: KtState; size: number }

/** Witness freshness cap regardless of what the server suggests. */
const MAX_WITNESS_AGE_MS = 30 * 24 * 3600_000;

/**
 * Verifies one account's keys against the log. `expected` is what the device is about to use: the
 * identity key it holds for the account and the roster the server just returned. Never throws for
 * malformed input; returns `log-error` instead. The returned state replaces the stored one only when
 * the status is not `log-error`.
 */
export function verifyAccount(proof: KtAccountProof, expected: { accountId: string; identityKey: string; roster: { deviceListVersion: number; devices: { deviceId: number; registrationId: number }[] } },
  deploymentId: string, state: KtState, now: number): KtResult {
  const fail = (status: KtStatus, reason: string): KtResult => ({ status, reason, state, size: state.last?.size ?? 0 });
  try {
    const h = proof.head;
    if (h.deploymentId !== deploymentId) return fail('log-error', 'wrong-deployment');
    if (state.logKey && state.logKey !== h.logKey) return fail('log-error', 'log-key-changed');
    const logKey = fromBase64Url(h.logKey), root = fromBase64Url(h.root);
    if (!ed25519.verify(fromBase64Url(h.signature), headBytes(h.deploymentId, h.size, root, h.timestamp), logKey)) return fail('log-error', 'bad-head-signature');
    // No rollback, no fork: the new head extends the last one this device accepted.
    if (state.last) {
      if (h.size < state.last.size) return fail('log-error', 'rollback');
      if (!verifyConsistency(state.last.size, h.size, fromBase64Url(state.last.root), root, proof.sinceConsistency.map(fromBase64Url))) return fail('log-error', 'inconsistent');
    }
    // Verifiable map: once seen, a head without one is a downgrade.
    const hasMap = !!(h.mapRoot && h.mapSignature && proof.mapProof);
    if (!hasMap && state.mapSeen) return fail('log-error', 'map-missing');
    if (hasMap && !ed25519.verify(fromBase64Url(h.mapSignature!), mapHeadBytes(h.deploymentId, h.size, fromBase64Url(h.mapRoot!), h.timestamp), logKey)) return fail('log-error', 'bad-map-signature');
    const witnesses = state.witnesses && Object.keys(state.witnesses).length ? state.witnesses : proof.witnesses;
    const next: KtState = { logKey: h.logKey, witnesses, last: { size: h.size, root: h.root, timestamp: h.timestamp, signature: h.signature }, mapSeen: state.mapSeen || hasMap };
    // The account's entry must be included and equal what the device is about to use.
    const leaf = proof.leaf;
    const leafDigest = leaf && leaf.accountId === expected.accountId
      ? leafHash(leafBytes(leaf.accountId, leaf.deviceListVersion, fromBase64Url(leaf.identityKey), fromBase64Url(leaf.deviceHash))) : null;
    // The map proves this is the account's newest entry (or that it has none) at this head.
    if (hasMap) {
      const implied = mapRootFromProof(mapKey(expected.accountId), leafDigest, fromBase64Url(proof.mapProof!.bitmap), proof.mapProof!.siblings.map(fromBase64Url));
      if (!implied || !equal(implied, fromBase64Url(h.mapRoot!))) return fail('log-error', 'not-newest');
    }
    if (!leaf || !leafDigest) return { status: 'mismatch', reason: 'no-entry', state: next, size: h.size };
    const devices = fromBase64Url(leaf.deviceHash);
    if (!verifyInclusion(leaf.index, h.size, leafDigest, proof.inclusion.map(fromBase64Url), root)) return fail('log-error', 'not-included');
    if (leaf.identityKey !== expected.identityKey) return { status: 'mismatch', reason: 'identity-key', state: next, size: h.size };
    if (leaf.deviceListVersion !== expected.roster.deviceListVersion) return { status: 'stale', reason: 'device-list-version', state: next, size: h.size };
    if (!equal(devices, deviceHash(expected.roster.devices))) return { status: 'mismatch', reason: 'devices', state: next, size: h.size };
    // Witnessed: a pinned witness co-signed a recent head that this head extends.
    const w = proof.witnessed;
    const maxAge = Math.min(proof.maxWitnessAgeMs || MAX_WITNESS_AGE_MS, MAX_WITNESS_AGE_MS);
    if (!w || w.head.deploymentId !== deploymentId || w.head.size > h.size) return { status: 'unwitnessed', state: next, size: h.size };
    const wRoot = fromBase64Url(w.head.root);
    const signedHead = headBytes(deploymentId, w.head.size, wRoot, w.head.timestamp);
    if (!ed25519.verify(fromBase64Url(w.head.signature), signedHead, logKey)) return fail('log-error', 'bad-witnessed-head');
    if (!verifyConsistency(w.head.size, h.size, wRoot, root, proof.witnessConsistency.map(fromBase64Url))) return fail('log-error', 'witness-inconsistent');
    // A pinned witness signed this head recently (by its own clock, not the head's age).
    // With a map, only version 2 counts: the witness recomputed the map root from the log's leaves.
    const wMap = w.head.mapRoot ? fromBase64Url(w.head.mapRoot) : null;
    const cosigned = w.cosignatures.some((c) => witnesses[c.witnessId] === c.publicKey && now - c.timestamp <= maxAge && (
      (c.version === 2 && wMap && ed25519.verify(fromBase64Url(c.signature), cosignedV2Bytes(signedHead, wMap, c.timestamp), fromBase64Url(c.publicKey)))
      || (!hasMap && (c.version ?? 1) === 1 && ed25519.verify(fromBase64Url(c.signature), cosignedBytes(signedHead, c.timestamp), fromBase64Url(c.publicKey)))));
    return { status: cosigned ? 'verified' : 'unwitnessed', state: next, size: h.size };
  } catch {
    return fail('log-error', 'malformed');
  }
}
