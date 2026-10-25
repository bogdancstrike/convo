#!/usr/bin/env node
// Convo key-transparency witness (specs §19.4, TRUST-01). Run it on a machine and under an operator
// independent of the Convo server. It co-signs a tree head only after checking that the log is signed
// by the pinned log key and only ever grew (RFC 9162 consistency proof from the last head it signed).
// A rollback or fork is never signed: the witness stops and logs the evidence.
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
  const unchanged = state.size === head.size && state.timestamp === head.timestamp;
  if (unchanged && Date.now() - (state.signedAt ?? 0) < resignMs) return;
  const at = Date.now();
  const signature = sign(null, cosignBytes(headBytes(head), at), key);
  const res = await fetch(`${base}/v1/kt/cosignatures`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ witnessId, size: head.size, timestamp: at, signature: b64u(signature) }) });
  if (!res.ok) throw new Error(`co-signature refused: ${res.status} ${await res.text()}`);
  saveState({ logKey: head.logKey, deploymentId: head.deploymentId, size: head.size, root: head.root, timestamp: head.timestamp, signedAt: at });
  log(`co-signed size ${head.size}${state.size === undefined ? ' (first use: log key pinned)' : ''}`);
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
