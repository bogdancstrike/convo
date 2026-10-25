#!/usr/bin/env node
// Convo key-transparency witness (specs §19.4, TRUST-01). Run it on a machine and under an operator
// independent of the Convo server. It co-signs a tree head only after checking that the log is signed
// by the pinned log key and only ever grew (RFC 9162 consistency proof from the last head it signed).
// With the verifiable map (heads carrying mapRoot), it also downloads every leaf (a request signed with
// its own key), recomputes the log root and the map (account -> newest leaf) and co-signs version 2
// only if both match what the server signed. A rollback, fork or wrong map is never signed: the
// witness stops and logs the evidence.
//
// Environment:
//   KT_LOG_URL        Convo origin, e.g. https://convo.example.org (or http://server:8080 in Compose)
//   KT_WITNESS_ID     this witness's name, as configured on the server (enclave.kt.witnesses)
//   KT_WITNESS_KEY    base64 32-byte Ed25519 seed (secret; `node witness.mjs --new-key` prints one)
//   KT_STATE_FILE     where the pinned log key and last signed head are kept (default /data/state.json)
//   KT_POLL_SECONDS   how often to look for a new head (default 30)
//   KT_RESIGN_SECONDS how often to re-sign an unchanged head, keeping it fresh (default 3600)
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');
const sha = (...parts) => { const h = createHash('sha256'); parts.forEach((p) => h.update(p)); return h.digest(); };
const node = (l, r) => sha(Buffer.of(1), l, r);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; };
const headBytes = (h) => Buffer.concat([Buffer.from(`CONVO-KT-HEAD-V1\n${h.deploymentId}\n`), u64(h.size), unb64u(h.root), u64(h.timestamp)]);
const cosignBytes = (head, at) => Buffer.concat([Buffer.from('CONVO-KT-COSIGN-V1\n'), u64(at), head]);
const cosignV2Bytes = (head, mapRoot, at) => Buffer.concat([Buffer.from('CONVO-KT-COSIGN-V2\n'), u64(at), head, mapRoot]);
const mapHeadBytes = (h) => Buffer.concat([Buffer.from(`CONVO-KT-MAP-V1\n${h.deploymentId}\n`), u64(h.size), unb64u(h.mapRoot), u64(h.timestamp)]);
const LEAF_LABEL = Buffer.from('CONVO-KT-LEAF-V1\n');

/** RFC 9162 tree hash over leaf hashes. */
function mth(leaves, from = 0, n = leaves.length) {
  if (n === 0) return sha();
  if (n === 1) return leaves[from];
  let k = 1; while (k * 2 < n) k *= 2;
  return node(mth(leaves, from, k), mth(leaves, from + k, n - k));
}

// Verifiable map (sparse Merkle tree); matches server/src/.../SparseMerkleMap.java and kt-map-v1.json.
const DEPTH = 256;
const EMPTY = [Buffer.alloc(32)];
for (let i = 1; i <= DEPTH; i++) EMPTY.push(node(EMPTY[i - 1], EMPTY[i - 1]));
const bit = (key, d) => (key[d >> 3] >> (7 - (d & 7))) & 1;
const mapKey = (accountBytes) => sha(Buffer.from('CONVO-KT-MAPKEY-V1\n'), accountBytes);
/** Map root over entries sorted by key ([key, value] buffers). */
export function mapRoot(entries, from = 0, to = entries.length, depth = 0) {
  if (from === to) return EMPTY[DEPTH - depth];
  if (to - from === 1) {
    const [k, v] = entries[from]; let h = sha(Buffer.of(2), k, v);
    for (let d = DEPTH - 1; d >= depth; d--) h = bit(k, d) ? node(EMPTY[DEPTH - d - 1], h) : node(h, EMPTY[DEPTH - d - 1]);
    return h;
  }
  let lo = from, hi = to;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bit(entries[mid][0], depth)) hi = mid; else lo = mid + 1; }
  return node(mapRoot(entries, from, lo, depth + 1), mapRoot(entries, lo, to, depth + 1));
}
const publicKey = (raw) => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

if (process.argv.includes('--new-key')) {
  const { privateKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12);
  console.log(`KT_WITNESS_KEY=${seed.toString('base64')}\n# server: enclave.kt.witnesses=<id>:${raw.toString('base64')}`);
  process.exit(0);
}

/** RFC 9162 §2.1.4.2 consistency verification. */
export function verifyConsistency(m, n, rootM, rootN, proof) {
  if (m < 1 || m > n) return false;
  if (m === n) return proof.length === 0 && rootM.equals(rootN);
  const nodes = (m & (m - 1)) === 0 ? [rootM, ...proof] : [...proof];
  if (nodes.length === 0) return false;
  let fn = m - 1, sn = n - 1;
  while (fn % 2 === 1) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
  let fr = nodes[0], sr = nodes[0];
  for (const c of nodes.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = node(c, fr); sr = node(c, sr);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else sr = node(sr, c);
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && fr.equals(rootM) && sr.equals(rootN);
}

const env = (name, fallback) => { const v = process.env[name] ?? fallback; if (v === undefined) { console.error(`${name} is required`); process.exit(2); } return v; };
const base = env('KT_LOG_URL').replace(/\/$/, '');
const witnessId = env('KT_WITNESS_ID');
const seed = Buffer.from(env('KT_WITNESS_KEY'), 'base64');
if (seed.length !== 32) { console.error('KT_WITNESS_KEY must be a base64 32-byte seed'); process.exit(2); }
const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
const stateFile = env('KT_STATE_FILE', '/data/state.json');
const pollMs = Number(env('KT_POLL_SECONDS', '30')) * 1000;
const resignMs = Number(env('KT_RESIGN_SECONDS', '3600')) * 1000;

const loadState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
const saveState = (s) => { writeFileSync(`${stateFile}.tmp`, JSON.stringify(s)); renameSync(`${stateFile}.tmp`, stateFile); };
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

/** Downloads leaves [from, to) with a request signed by this witness's key. */
async function fetchLeaves(from, to) {
  const out = [];
  for (let start = from; start < to; start += 1000) {
    const end = Math.min(to, start + 1000);
    const at = Date.now();
    const signature = b64u(sign(null, Buffer.from(`CONVO-KT-READ-V1\n${start}\n${end}\n${at}`), key));
    const res = await fetch(`${base}/v1/kt/leaves?from=${start}&to=${end}`, { headers: { accept: 'application/json', 'X-KT-Witness': witnessId, 'X-KT-Timestamp': String(at), 'X-KT-Signature': signature } });
    if (!res.ok) throw new Error(`GET leaves ${start}-${end}: ${res.status}`);
    out.push(...(await res.json()).leaves.map(unb64u));
  }
  return out;
}

/**
 * Brings the witness's own copy of the log up to `head` and checks it: every leaf hashes as served,
 * the log root equals the signed root, and the map built from each account's newest leaf equals the
 * signed map root. Returns the extended copy (persisted only after co-signing).
 */
async function verifyMap(state, head) {
  const leaves = state.leaves ? state.leaves.map(unb64u) : [];
  const latest = new Map(Object.entries(state.latest ?? {}));
  if (head.size > leaves.length) {
    for (const leaf of await fetchLeaves(leaves.length, head.size)) {
      if (!leaf.subarray(0, LEAF_LABEL.length).equals(LEAF_LABEL)) throw new Halt('malformed leaf');
      const hash = sha(Buffer.of(0), leaf);
      leaves.push(hash);
      latest.set(mapKey(leaf.subarray(LEAF_LABEL.length, LEAF_LABEL.length + 16)).toString('hex'), hash.toString('hex'));
    }
  }
  if (!mth(leaves, 0, head.size).equals(unb64u(head.root))) throw new Halt(`served leaves do not produce the signed root at size ${head.size}`);
  const entries = [...latest.entries()].map(([k, v]) => [Buffer.from(k, 'hex'), Buffer.from(v, 'hex')]).sort((a, b) => Buffer.compare(a[0], b[0]));
  if (!mapRoot(entries).equals(unb64u(head.mapRoot))) throw new Halt(`map root at size ${head.size} does not match the log`);
  return { leaves: leaves.map(b64u), latest: Object.fromEntries(latest) };
}

async function round() {
  const state = loadState();
  const head = await get('/v1/kt/head');
  // Pin the log key and deployment on first use; afterwards a change is never signed.
  if (state.logKey && (state.logKey !== head.logKey || state.deploymentId !== head.deploymentId)) throw new Halt(`log key or deployment changed (pinned ${state.logKey}/${state.deploymentId}, got ${head.logKey}/${head.deploymentId})`);
  if (!verify(null, headBytes(head), publicKey(unb64u(head.logKey)), unb64u(head.signature))) throw new Halt(`bad head signature at size ${head.size}`);
  if (state.size !== undefined) {
    if (head.size < state.size) throw new Halt(`rollback: head ${head.size} < signed ${state.size}`);
    const proof = head.size === state.size ? [] : (await get(`/v1/kt/consistency?from=${state.size}&to=${head.size}`)).proof.map(unb64u);
    if (!verifyConsistency(state.size, head.size, unb64u(state.root), unb64u(head.root), proof)) throw new Halt(`fork: head ${head.size} does not extend signed ${state.size}`);
  }
  const unchanged = state.size === head.size && state.timestamp === head.timestamp && (state.mapRoot ?? null) === (head.mapRoot ?? null);
  if (unchanged && Date.now() - (state.signedAt ?? 0) < resignMs) return;
  // A head with a map: check its signature and recompute it before co-signing version 2.
  let copy = { leaves: state.leaves, latest: state.latest };
  if (head.mapRoot) {
    if (!head.mapSignature || !verify(null, mapHeadBytes(head), publicKey(unb64u(head.logKey)), unb64u(head.mapSignature))) throw new Halt(`bad map signature at size ${head.size}`);
    copy = await verifyMap(state, head);
  } else if (state.mapRoot) throw new Halt(`the log dropped its map at size ${head.size}`);
  const at = Date.now();
  const version = head.mapRoot ? 2 : 1;
  const signature = sign(null, version === 2 ? cosignV2Bytes(headBytes(head), unb64u(head.mapRoot), at) : cosignBytes(headBytes(head), at), key);
  const res = await fetch(`${base}/v1/kt/cosignatures`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ witnessId, size: head.size, timestamp: at, signature: b64u(signature), version }) });
  if (!res.ok) throw new Error(`co-signature refused: ${res.status} ${await res.text()}`);
  saveState({ logKey: head.logKey, deploymentId: head.deploymentId, size: head.size, root: head.root, timestamp: head.timestamp, signedAt: at,
    mapRoot: head.mapRoot ?? null, ...copy });
  log(`co-signed size ${head.size} (v${version})${state.size === undefined ? ' (first use: log key pinned)' : ''}`);
}

class Halt extends Error {}
log(`witness ${witnessId} watching ${base}`);
for (;;) {
  try { await round(); }
  catch (e) {
    if (e instanceof Halt) { log(`ALERT, not signing: ${e.message}`); process.exit(3); }
    log(`retrying: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
