#!/usr/bin/env node
// Convo archive/bot runtime (FR-EXT-02, ARCHIVE-01). Runs the same end-to-end encryption core as the
// Android app (apps/android/app/src/main/assets/core.js) in headless Chromium with a persistent
// profile, signed in as a dedicated integration account. Mark that account as an archive or bot in
// the admin console first: every chat it is in then shows a banner naming it and its retention.
//
// Modes:
//   archive  appends every message it can read to ARCHIVE_FILE (JSON lines, plaintext, mode 0600)
//   bot      calls BOT_HANDLER for direct messages and messages that mention the account
//
// Environment:
//   CONVO_URL            Convo origin, e.g. https://convo.example.org
//   BOT_MODE             archive | bot (default archive)
//   DATA_DIR             persistent directory: browser profile (keys, encrypted store), cursor, archive
//   ARCHIVE_FILE         default $DATA_DIR/archive.jsonl
//   ARCHIVE_RETENTION_DAYS  prune archived lines older than this at start and daily (unset: keep)
//   BOT_HANDLER          ES module exporting `default async (message, convo) => void` (bot mode)
//   CORE_JS              path to core.js (default ./core.js next to this file)
//   PLAYWRIGHT_MODULE    module to import chromium from (default "playwright")
//   INSECURE_TLS=1       accept self-signed certificates (development only)
//
// Sign-in: on first start it prints a link and a code (OAuth device authorization grant, client
// "convo-integration"). Open it, sign in as the integration account, and it enrolls a device of
// platform "integration". Later starts reuse the profile. Nothing secret is written besides the
// browser profile, which holds the device keys like any Convo client.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const env = (name, fallback) => process.env[name] ?? fallback;
const origin = new URL(env('CONVO_URL') ?? (() => { console.error('CONVO_URL is required'); process.exit(2); })()).origin;
const mode = env('BOT_MODE', 'archive');
if (!['archive', 'bot'].includes(mode)) { console.error('BOT_MODE must be archive or bot'); process.exit(2); }
const dataDir = resolve(env('DATA_DIR', './data'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const archiveFile = env('ARCHIVE_FILE', join(dataDir, 'archive.jsonl'));
const cursorFile = join(dataDir, 'cursor.json');
const coreJs = readFileSync(env('CORE_JS', join(dirname(fileURLToPath(import.meta.url)), 'core.js')), 'utf8');
const insecure = env('INSECURE_TLS') === '1';
if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const { chromium } = await import(env('PLAYWRIGHT_MODULE', 'playwright'));
const handler = mode === 'bot' && env('BOT_HANDLER') ? (await import(pathToFileURL(resolve(env('BOT_HANDLER'))).href)).default : null;
if (mode === 'bot' && typeof handler !== 'function') { console.error('BOT_HANDLER must export a default function in bot mode'); process.exit(2); }

// --- the core in a headless page on the Convo origin (same-origin API, secure context) -----------
const context = await chromium.launchPersistentContext(join(dataDir, 'profile'), { headless: true, ignoreHTTPSErrors: insecure, bypassCSP: true });
const page = context.pages()[0] ?? await context.newPage();
const pending = new Map();
let nextId = 1;
let phase = 'starting';
let accountId = null;
let signingIn = false;
const call = (method, args = {}) => new Promise((ok, fail) => {
  const id = nextId++;
  pending.set(id, { ok, fail });
  void page.evaluate((json) => window.ConvoCore.command(json), JSON.stringify({ id, method, args }));
});
await page.exposeFunction('__convoEmit', (json) => {
  const { type, value } = JSON.parse(json);
  if (type === 'result') {
    const p = pending.get(value.id); pending.delete(value.id);
    if (p) value.ok ? p.ok(value.value) : p.fail(new Error(value.error));
  } else if (type === 'diagnostic') {
    log(`core: ${value.stage}${value.name ? ` (${value.name})` : ''}`);
  } else if (type === 'phase') {
    phase = value.name;
    log(`phase: ${phase}`);
    if (phase === 'welcome' && !signingIn) void signIn();
    if (phase === 'link') log(`This account already has devices. Approve this device from one of them: code ${value.code}`);
    if (phase === 'revoked') { log('This device was signed out (revoked). Remove DATA_DIR/profile to enroll again.'); process.exit(4); }
  } else if (type === 'snapshot') {
    if (!accountId) log(`signed in as account ${value.accountId} (${mode} mode)`);
    accountId = value.accountId;
    phase = 'ready';
    schedule();
  }
});
await page.addInitScript(() => { window.NativeConvo = { emit: (json) => window.__convoEmit(json) }; window.ConvoPlatform = 'integration'; });
// An empty page on the Convo origin: the web app itself does not run here, only the core.
await page.route(`${origin}/__convo-integration__`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Convo integration</title>' }));
await page.goto(`${origin}/__convo-integration__`);
await page.addScriptTag({ content: coreJs });

// --- sign-in: OAuth 2.0 device authorization grant (RFC 8628) ------------------------------------
async function signIn() {
  signingIn = true;
  try {
    const info = await (await fetch(`${origin}/v1/deployment-info`)).json();
    const discovery = await (await fetch(`${info.oidc.issuer}/.well-known/openid-configuration`)).json();
    const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
    const start = await (await fetch(discovery.device_authorization_endpoint, form({ client_id: 'convo-integration', scope: 'openid profile phone' }))).json();
    if (!start.device_code) throw new Error(`device sign-in refused: ${JSON.stringify(start)}`);
    log(`SIGN IN: open ${start.verification_uri_complete ?? start.verification_uri} and sign in as the integration account (code ${start.user_code})`);
    const deadline = Date.now() + start.expires_in * 1000;
    let interval = (start.interval ?? 5) * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const token = await (await fetch(discovery.token_endpoint, form({ client_id: 'convo-integration', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: start.device_code }))).json();
      if (token.access_token) { log('device sign-in complete; enrolling'); await call('signIn', { token: token.access_token }); return; }
      if (token.error === 'slow_down') interval += 5000;
      else if (token.error !== 'authorization_pending') throw new Error(`device sign-in failed: ${token.error}`);
    }
    throw new Error('device sign-in expired; restart to try again');
  } catch (e) { log(e.message); process.exit(3); }
  finally { signingIn = false; }
}

// --- archive / bot loop ---------------------------------------------------------------------------
let cursor = existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, 'utf8')).after ?? 0 : 0;
let timer = null;
let running = false;
function schedule() { clearTimeout(timer); timer = setTimeout(() => void drain(), 500); }

async function drain() {
  if (running || phase !== 'ready') return;
  running = true;
  try {
    for (;;) {
      const batch = await call('archiveSince', { after: cursor });
      if (!batch.length) break;
      for (const m of batch) {
        if (mode === 'archive') archive(m);
        else if (m.direction === 'in' && (m.conversationKind === 'direct' || (m.mentions ?? []).includes(accountId))) await respond(m);
        cursor = m.sort;
      }
      writeFileSync(`${cursorFile}.tmp`, JSON.stringify({ after: cursor })); renameSync(`${cursorFile}.tmp`, cursorFile);
    }
  } catch (e) { log(`will retry: ${e.message}`); }
  finally { running = false; }
}

function archive(m) {
  const line = { archivedAt: new Date().toISOString(), conversationId: m.conversationId, conversation: m.conversationTitle, kind: m.conversationKind,
    messageId: m.id, authorId: m.authorId, author: m.authorName, sentAt: new Date(m.sort).toISOString(), body: m.body ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ fileName: a.fileName, contentType: a.contentType, size: a.size })), edited: m.revision > 0 || undefined, deleted: m.deleted || undefined };
  const fresh = !existsSync(archiveFile);
  appendFileSync(archiveFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  if (fresh) chmodSync(archiveFile, 0o600);
}

async function respond(m) {
  const convo = {
    accountId,
    reply: (text) => call('send', { conversationId: m.conversationId, body: String(text), quote: { messageId: m.id, authorId: m.authorId, excerpt: (m.body ?? '').slice(0, 256) } }),
    call,
  };
  try { await handler(m, convo); } catch (e) { log(`handler failed for message ${m.id}: ${e.message}`); }
}

// Retention: archived lines older than ARCHIVE_RETENTION_DAYS are removed at start and daily.
function prune() {
  const days = Number(env('ARCHIVE_RETENTION_DAYS', ''));
  if (!days || !existsSync(archiveFile)) return;
  const cutoff = Date.now() - days * 86_400_000;
  const kept = readFileSync(archiveFile, 'utf8').split('\n').filter((l) => l && Date.parse(JSON.parse(l).sentAt) >= cutoff);
  writeFileSync(`${archiveFile}.tmp`, kept.map((l) => `${l}\n`).join(''), { mode: 0o600 }); renameSync(`${archiveFile}.tmp`, archiveFile);
}
if (mode === 'archive') { prune(); setInterval(prune, 86_400_000); }
setInterval(schedule, 60_000); // safety net if an event was missed
const stop = async () => { await context.close().catch(() => undefined); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
log(`Convo ${mode} runtime starting for ${origin}`);
