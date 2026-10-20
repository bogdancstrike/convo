import { EnclaveApi } from '../../web/src/api/enclaveApi';
import { HttpClient } from '../../web/src/api/http';
import { ApiError } from '../../web/src/api/errors';
import { EnclaveClient, LogoutRecoveryRequiredError } from '../../web/src/core/client';
import { createClient, type LocalContext } from '../../web/src/core/bootstrap';
import { enrollPrimary } from '../../web/src/core/enrollment';
import { LinkRequest } from '../../web/src/core/linking';
import { recoverAccount } from '../../web/src/core/recovery';
import { Repositories } from '../../web/src/core/repositories';
import { EncryptedStore } from '../../web/src/storage/encryptedStore';
import { SignalStore } from '../../web/src/crypto/signalStore';
import { fromBase64Url, toBase64Url } from '../../web/src/lib/bytes';
import type { ChatMessage } from '../../web/src/core/model';
import type { PrimaryRegistrationRequest, LinkRegistrationRequest } from '../../web/src/api/types';
import { prepareProfilePhoto } from '../../web/src/core/profile';

// Only packaged JavaScript runs here. This bridge never exposes protocol keys to native views.
declare global { interface Window { NativeConvo: { emit(json: string): void }; ConvoCore: { command(json: string): void } } }
class AndroidApi extends EnclaveApi {
  override registerPrimary(token: string, request: PrimaryRegistrationRequest) { return super.registerPrimary(token, { ...request, platform: 'android' }); }
  override linkDevice(token: string, request: LinkRegistrationRequest) { return super.linkDevice(token, { ...request, platform: 'android' }); }
  override recoverDevice(token: string, registration: PrimaryRegistrationRequest, authorizationKey: string) { return super.recoverDevice(token, { ...registration, platform: 'android' }, authorizationKey); }
}
let context: LocalContext; let client: EnclaveClient | null = null;
let accessToken = ''; let active: string | null = null; let refreshTimer: ReturnType<typeof setTimeout>;
let link: LinkRequest | null = null; let linkTimer: ReturnType<typeof setTimeout>;
const emit = (type: string, value: unknown) => window.NativeConvo.emit(JSON.stringify({ type, value }));
const publicMessage = (message: ChatMessage) => ({ ...message, attachments: message.attachments?.map((p) => ({
  attachmentId: p.attachmentId, contentType: p.contentType, fileName: p.fileName, size: p.size,
  width: p.width, height: p.height, durationMs: p.durationMs, thumbnail: p.thumbnail, voiceNote: p.voiceNote,
})) });
async function snapshot() {
  if (!client) return;
  emit('snapshot', { accountId: client.accountId, device: client.device, conversations: client.conversations(),
    settings: client.settings, history: client.historyStatus, connection: client.socket.state,
    profiles: Object.fromEntries(client.profiles()), active, messages: active ? (await client.messages(active, 1000)).map(publicMessage) : [] });
}
const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void snapshot().catch(() => undefined), 60); };
async function startClient() {
  client = await createClient(context); if (!client) { emit('phase', { name: 'welcome' }); return; }
  for (const event of ['messages', 'conversations', 'settings', 'profiles', 'history', 'groups', 'connection', 'devices'] as const) client.on(event, refresh);
  client.on('revoked', () => emit('phase', { name: 'revoked' }));
  emit('phase', { name: 'loading' }); await client.start(); accessToken = ''; link = null;
  emit('phase', { name: 'ready' }); await snapshot();
  void client.lastSeenHeartbeat().catch(() => undefined);
}
async function startLink() {
  link = await LinkRequest.start(context.api, accessToken, 'Convo Android');
  emit('phase', { name: 'link', code: link.code });
  const poll = async () => {
    try {
      if (!link) return;
      const outcome = await link.poll();
      if (outcome === 'approved') { await link.complete(context.repos); await startClient(); return; }
      if (outcome !== 'waiting') { emit('phase', { name: 'linkEnded', reason: outcome }); return; }
    } catch { /* Retry while offline; the request has a server-enforced expiry. */ }
    linkTimer = setTimeout(() => void poll(), 2000);
  };
  void poll();
}
async function target(args: Record<string, any>) {
  if (!client) throw new Error('not ready');
  const message = (await client.messages(args.conversationId, Number.MAX_SAFE_INTEGER)).find((m) => m.id === args.id && m.authorId === args.authorId);
  if (!message || message.deleted) throw new Error('message unavailable'); return message;
}
async function command(method: string, args: Record<string, any>): Promise<unknown> {
  if (method === 'signIn') {
    emit('diagnostic', { stage: 'enrollment', secure: window.isSecureContext });
    accessToken = args.token; emit('phase', { name: 'loading' });
    try { await enrollPrimary(context.api, accessToken, context.repos); await startClient(); }
    catch (e) { if (e instanceof ApiError && e.code === 'ACCOUNT_HAS_DEVICES') await startLink(); else throw e; }
    return;
  }
  if (method === 'recover') { clearTimeout(linkTimer); await recoverAccount(context.api, accessToken, args.code, context.repos); await startClient(); return; }
  if (method === 'newLink') { clearTimeout(linkTimer); await startLink(); return; }
  if (!client) throw new Error('not ready');
  switch (method) {
    case 'snapshot': return snapshot();
    case 'open': active = args.id; await client.setActiveConversation(active); await snapshot(); return;
    case 'close': active = null; await client.setActiveConversation(null); await snapshot(); return;
    case 'search': return (await client.searchMessages(String(args.query))).map(publicMessage);
    case 'directory': return client.searchDirectory(String(args.query));
    case 'account': return client.account(String(args.id));
    case 'newChat': { const account = args.id === client.accountId ? { accountId: client.accountId, username: client.device.username, displayName: client.device.displayName } : await client.account(args.id); if (!account) throw new Error('account unavailable'); return client.openConversation(account); }
    case 'send': return client.sendText(args.conversationId, String(args.body), args.quote);
    case 'attach': {
      const bytes = fromBase64Url(args.data); const file = new File([bytes], String(args.name), { type: String(args.mime) });
      return args.voice ? client.sendVoiceNote(args.conversationId, file, Number(args.duration)) : client.sendAttachments(args.conversationId, [file], String(args.caption ?? ''));
    }
    case 'download': {
      const message = await target(args); const pointer = message.attachments?.[Number(args.index)]; if (!pointer) throw new Error('attachment unavailable');
      const blob = await client.downloadAttachment(pointer); return { data: toBase64Url(await blob.arrayBuffer()), name: pointer.fileName, mime: pointer.contentType };
    }
    case 'star': return client.setStarred(await target(args), Boolean(args.value));
    case 'react': return client.react(await target(args), String(args.emoji));
    case 'edit': return client.edit(await target(args), String(args.body));
    case 'deleteMessage': return args.everyone ? client.deleteForEveryone(await target(args)) : client.deleteLocally(await target(args));
    case 'forward': return client.forward(await target(args), String(args.destination));
    case 'retry': return client.retry(await target(args));
    case 'conversation': return client.updateConversation(args.id, args.patch);
    case 'clear': return client.clearConversation(args.id);
    case 'deleteChat': return client.deleteConversation(args.id);
    case 'mute': return client.setMute(args.id, args.until ?? null);
    case 'settings': return client.updateSettings(args.patch);
    case 'profile': {
      const patch = { ...args.patch };
      if (patch.photo && typeof patch.photo === 'string') { const bytes = fromBase64Url(patch.photo); patch.photo = await prepareProfilePhoto(new File([bytes], 'profile', { type: args.mime })); }
      if (args.removePhoto) patch.photo = undefined; return client.updateProfile(patch);
    }
    case 'privacy': return client.lastSeenPrivacy();
    case 'setPrivacy': return client.setLastSeenPrivacy(Boolean(args.enabled));
    case 'lastSeen': return client.lastSeen(args.id);
    case 'heartbeat': return client.lastSeenHeartbeat();
    case 'recoveryStatus': return client.recoveryStatus();
    case 'recoveryCode': return client.createRecoveryCode();
    case 'sync': return client.syncHistory();
    case 'devices': return client.devices();
    case 'unlink': return client.unlinkDevice(Number(args.id));
    case 'linkRequests': return client.incomingLinkRequests();
    case 'approveLink': return client.approveLink(args.request);
    case 'declineLink': return client.declineLink(args.request);
    case 'group': return client.groupRecord(args.id);
    case 'createGroup': { const members = await Promise.all((args.members as string[]).map((id) => client!.account(id))); if (members.some((m) => !m)) throw new Error('member unavailable'); return client.createGroup(String(args.name), members.filter((m) => Boolean(m)) as any, Boolean(args.channel)); }
    case 'addMembers': return client.addGroupMembers(args.id, args.members);
    case 'removeMember': return client.removeGroupMember(args.id, args.member);
    case 'role': return client.changeGroupRole(args.id, args.member, args.role);
    case 'verify': return client.setVerified(args.id, Boolean(args.verified));
    case 'identity': { const keys = await client.identityKeys(args.id); if (!keys.remote) return { verified: keys.verified }; const { FingerprintGenerator } = await import('@privacyresearch/libsignal-protocol-typescript'); return { verified: keys.verified, digits: await new FingerprintGenerator(5200).createFor(client.accountId, fromBase64Url(keys.local).buffer, args.id, fromBase64Url(keys.remote).buffer) }; }
    case 'discover': {
      // Send only explicit full-number queries, no contact names/photos or persistent uploads.
      const numbers = [...new Set((args.numbers as string[]).filter((n) => /^\+[1-9][0-9]{6,14}$/.test(n)))];
      if (numbers.length > 100) throw new Error('discovery batch too large');
      const found = new Map<string, unknown>();
      for (const number of numbers) {
        for (const account of await client.searchDirectory(number)) {
          if (account.accountId !== client.accountId && account.phone?.replace(/\D/g, '') === number.slice(1)) found.set(account.accountId, account);
        }
      }
      return [...found.values()];
    }
    case 'logout': await client.signOutAndWipe(); client = null; active = null; context = await openContext(); emit('phase', { name: 'welcome' }); return;
    default: throw new Error('unsupported command');
  }
}
async function openContext(): Promise<LocalContext> {
  const store = await EncryptedStore.open(); return { store, repos: new Repositories(store), signal: new SignalStore(store), api: new AndroidApi(new HttpClient()) };
}
window.ConvoCore = { command(json: string) {
  if (json.length > 150 * 1024 * 1024) return;
  let request: { id: number; method: string; args?: Record<string, any> };
  try { request = JSON.parse(json); } catch { return; }
  void command(request.method, request.args ?? {}).then((value) => { emit('result', { id: request.id, ok: true, value }); refresh(); })
    .catch((e) => { emit('diagnostic', { stage: request.method, name: e instanceof Error ? e.name : 'unknown' }); emit('result', { id: request.id, ok: false, error: e instanceof LogoutRecoveryRequiredError ? 'recovery-required' : e instanceof ApiError ? e.code : 'operation-failed' }); });
} };
void (async () => { context = await openContext(); await startClient(); })().catch(() => emit('phase', { name: 'error' }));

setInterval(() => { if (client && document.visibilityState === 'visible') void client.lastSeenHeartbeat().catch(() => undefined); }, 20000);
