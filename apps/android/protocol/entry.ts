import { safetyNumber } from '../../web/src/crypto/safetyNumber';
import { deploymentInfo, loadDeploymentInfo } from '../../web/src/config/deployment';
import { MAX_ATTACHMENT_BYTES, configureAttachmentLimit } from '../../web/src/core/attachments';
import { EnclaveApi } from '../../web/src/api/enclaveApi';
import { HttpClient } from '../../web/src/api/http';
import { ApiError } from '../../web/src/api/errors';
import { STICKER_PACKS } from '../../web/src/core/stickers';
import { makeStickerImage } from '../../web/src/core/customStickers';
import { CallKeyUnavailableError, EditNotAllowedError, EnclaveClient, LogoutRecoveryRequiredError, SendRestrictedError } from '../../web/src/core/client';
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
import { filterShared, selectedMessages, sharedEntries, downloadName, type SharedFilter } from '../../web/src/core/sharedMedia';
import { zipSync } from '../../web/node_modules/fflate/esm/browser';
import { toIcs } from '../../web/src/core/events';

// Only packaged JavaScript runs here. This bridge never exposes protocol keys to native views.
// ConvoPlatform: 'integration' when the bundle runs in the archive/bot runtime (deploy/convo-bot).
declare global { interface Window { NativeConvo: { emit(json: string): void }; ConvoCore: { command(json: string): void }; ConvoPlatform?: string } }
const PLATFORM = window.ConvoPlatform === 'integration' ? 'integration' : 'android';
class AndroidApi extends EnclaveApi {
  override registerPrimary(token: string, request: PrimaryRegistrationRequest) { return super.registerPrimary(token, { ...request, platform: PLATFORM }); }
  override linkDevice(token: string, request: LinkRegistrationRequest) { return super.linkDevice(token, { ...request, platform: PLATFORM }); }
  override recoverDevice(token: string, registration: PrimaryRegistrationRequest, authorizationKey: string) { return super.recoverDevice(token, { ...registration, platform: PLATFORM }, authorizationKey); }
}
let context: LocalContext; let client: EnclaveClient | null = null;
let accessToken = ''; let active: string | null = null; let refreshTimer: ReturnType<typeof setTimeout>;
let link: LinkRequest | null = null; let linkTimer: ReturnType<typeof setTimeout>;
const emit = (type: string, value: unknown) => window.NativeConvo.emit(JSON.stringify({ type, value }));
// editableUntil lets native UI offer Edit with the same policy the shared core enforces.
const publicMessage = (message: ChatMessage) => ({ ...message, editableUntil: client?.editableUntil(message), attachments: message.attachments?.map((p) => ({
  attachmentId: p.attachmentId, contentType: p.contentType, fileName: p.fileName, size: p.size,
  width: p.width, height: p.height, durationMs: p.durationMs, thumbnail: p.thumbnail, voiceNote: p.voiceNote,
})) });
async function snapshot() {
  if (!client) return;
  // Group previews name their author ("Ana: …"), resolved here because the list has no directory.
  const conversations = await Promise.all(client.conversations().map(async (c) => c.kind === 'group' && c.previewAuthor && !c.previewFromMe
    ? { ...c, previewAuthorName: await client!.displayName(c.previewAuthor) } : c));
  emit('snapshot', { accountId: client.accountId, device: client.device, conversations,
    limits: { attachmentMaxBytes: MAX_ATTACHMENT_BYTES }, settings: client.settings,
    // Organization policy in force (verified by the core) and why a newer one was rejected, if so.
    policy: client.policy, policyInfo: client.policyInfo, policyIssue: client.policyIssue, history: client.historyStatus, connection: client.socket.state,
    profiles: Object.fromEntries(client.profiles()), active, messages: active ? await Promise.all((await client.messages(active, 1000)).map(async (m) => ({
      ...publicMessage(m), mentionLabels: m.mentions?.length ? await Promise.all(m.mentions.map((id) => client!.displayName(id))) : undefined,
      // Acknowledgements: reviewer names for members; audience names only for reviewers.
      ackNames: m.ackRequest ? Object.fromEntries(await Promise.all([...new Set([...m.ackRequest.reviewers,
        ...(m.ackRequest.reviewers.includes(client!.accountId) ? m.ackRequest.audience : [])])].map(async (id) => [id, id === client!.accountId ? 'You' : await client!.displayName(id)]))) : undefined,
    }))) : [] });
}
const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void snapshot().catch(() => undefined), 60); };
async function startClient() {
  client = await createClient(context); if (!client) { emit('phase', { name: 'welcome' }); return; }
  for (const event of ['messages', 'conversations', 'settings', 'profiles', 'history', 'groups', 'connection', 'devices', 'scheduled', 'folders', 'policy'] as const) client.on(event, refresh);
  client.on('revoked', () => emit('phase', { name: 'revoked' }));
  // Calls: ring/accept/decline/end events and history changes go to the native call UI.
  client.on('call', (event) => emit('call', event));
  client.on('callLog', () => emit('callLog', {}));
  client.on('stickers', () => emit('stickers', {}));
  // The title travels with the alert: a brand-new chat is not in the last snapshot yet.
  client.on('reminder', (reminder) => emit('reminder', reminder));
  client.on('alert', (alert) => emit('alert', { ...alert, title: client?.conversations().find((c) => c.id === alert.conversationId)?.title }));
  client.on('typing', (event) => emit('typing', event));
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
/** Event fields from a bridge call (the core validates them). */
const eventInput = (args: Record<string, any>) => ({ title: String(args.title ?? ''), start: Number(args.start), end: args.end ? Number(args.end) : undefined,
  zone: args.zone ? String(args.zone) : undefined, location: args.location ? String(args.location) : undefined, description: args.description ? String(args.description) : undefined });
async function target(args: Record<string, any>) {
  if (!client) throw new Error('not ready');
  const message = (await client.messages(args.conversationId, Number.MAX_SAFE_INTEGER)).find((m) => m.id === args.id && m.authorId === args.authorId);
  if (!message || message.deleted) throw new Error('message unavailable'); return message;
}
/** A community this account belongs to (fresh server view + E2EE names). */
async function community(id: unknown) {
  if (!client) throw new Error('not ready');
  const found = (await client.communities()).find((c) => c.communityId === String(id));
  if (!found) throw new Error('community unavailable'); return found;
}
async function mediaEntries(args: Record<string, any>) {
  if (!client) throw new Error('not ready');
  // Native chat locks are device-local: locked chats never appear in global media.
  const excluded = new Set(Array.isArray(args.exclude) ? args.exclude.map(String) : []);
  const conversations = client.conversations().filter((c) => (!args.conversationId || c.id === args.conversationId) && !excluded.has(c.id));
  const messages = (await Promise.all(conversations.map((c) => client!.messages(c.id, Number.MAX_SAFE_INTEGER)))).flat();
  return sharedEntries(messages, conversations);
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
    case 'mediaEntries': {
      const entries = filterShared(await mediaEntries(args), args.filter as SharedFilter, client.accountId);
      return { total: entries.length, entries: entries.slice(0, Math.min(Number(args.limit) || 60, 1000)).map((entry) => ({
        key: entry.key, message: publicMessage(entry.message), conversation: { id: entry.conversation.id, title: entry.conversation.title },
        attachmentIndex: entry.attachment ? entry.message.attachments!.findIndex((p) => p.attachmentId === entry.attachment!.attachmentId) : -1,
        link: entry.link, size: entry.size,
      })) };
    }
    case 'mediaAction': {
      const keys = args.keys as string[];
      if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new Error('selection limit');
      const selected = (await mediaEntries({})).filter((entry) => keys.includes(entry.key));
      if (selected.length !== new Set(keys).size) throw new Error('selection changed');
      const originals = [...new Map(selected.map((e) => [`${e.message.conversationId}/${e.message.authorId}/${e.message.id}`, e.message])).values()];
      if (args.action === 'star') { const value = !originals.every((m) => m.starred); for (const message of originals) await client.setStarred(message, value); }
      else if (args.action === 'delete') { for (const message of originals) await client.deleteLocally(message); }
      else if (args.action === 'forward') { for (const message of selectedMessages(selected)) await client.forward(message, String(args.destination)); }
      else if (args.action === 'download') {
        // The JSON bridge adds base64 overhead; bound memory on phone before downloading.
        if (selected.reduce((sum, e) => sum + e.size, 0) > 64 * 1024 * 1024) throw new Error('download limit');
        const files: Record<string, Uint8Array<ArrayBuffer>> = {};
        for (const [index, entry] of selected.entries()) files[downloadName(entry.attachment?.fileName ?? 'link.txt', index)] = entry.attachment
          ? new Uint8Array(await (await client.downloadAttachment(entry.attachment)).arrayBuffer()) : new TextEncoder().encode(entry.link!);
        return { name: 'convo-media.zip', mime: 'application/zip', data: toBase64Url(zipSync(files, { level: 0 })) };
      } else throw new Error('unsupported action');
      return;
    }
    // Background handoff: the activity closes the socket shortly after leaving the screen when a
    // push distributor can wake it, so the server sends wakes instead of writing to a socket the
    // OS is about to freeze. Mail stays in the server mailbox until the next start.
    case 'background': client.socket.stop(); return;
    case 'foreground': client.socket.start(); return;
    case 'typing': return client.sendTyping(String(args.conversationId), args.action === 'stopped' ? 'stopped' : 'started');
    case 'snapshot': return snapshot();
    case 'open': active = args.id; await client.setActiveConversation(active); await snapshot(); return;
    case 'close': active = null; await client.setActiveConversation(null); await snapshot(); return;
    case 'search': return (await client.searchMessages(String(args.query))).map(publicMessage);
    case 'directory': return client.searchDirectory(String(args.query));
    case 'account': return client.account(String(args.id));
    case 'newChat': { const account = args.id === client.accountId ? { accountId: client.accountId, username: client.device.username, displayName: client.device.displayName } : await client.account(args.id); if (!account) throw new Error('account unavailable'); return client.openConversation(account); }
    case 'send': return client.sendText(args.conversationId, String(args.body), args.quote, Array.isArray(args.mentions) ? args.mentions.map(String) : undefined, ackOptions(args.requestAck), { silent: args.silent === true, topic: args.topic ? String(args.topic) : undefined });
    // Group topics (specs §30.4): owners/admins manage them; the snapshot carries conversation.topics.
    case 'createTopic': return client.createTopic(String(args.conversationId), String(args.name));
    // Slow mode and restricted members (owners/admins); the snapshot carries conversation.memberPolicy.
    case 'setMemberPolicy': return client.setMemberPolicy(String(args.conversationId), {
      slowModeSeconds: args.slowModeSeconds === undefined ? undefined : Number(args.slowModeSeconds),
      restricted: Array.isArray(args.restricted) ? args.restricted.map(String) : undefined });
    case 'updateTopic': return client.updateTopic(String(args.conversationId), String(args.id), { name: args.name === undefined ? undefined : String(args.name), closed: args.closed === undefined ? undefined : Boolean(args.closed) });
    // Scheduled send (specs §30.4): device-owned items, sent by the core's timer while the app runs.
    case 'scheduleMessage': return client.scheduleMessage(String(args.conversationId), String(args.body), Number(args.dueAt), { quote: args.quote ?? undefined, mentions: Array.isArray(args.mentions) ? args.mentions.map(String) : undefined, silent: args.silent === true });
    // Private chat folders (specs §30.4): own-device preference synced to own devices.
    // Abuse reports (AC-SEC-09): evidence chosen by key ("authorId/id"), sent E2EE to the contact.
    case 'reportRecipients': return client.reportRecipients();
    case 'sendReport': {
      const keys = new Set(Array.isArray(args.keys) ? args.keys.map(String) : []);
      const messages = (await client.messages(String(args.conversationId), Number.MAX_SAFE_INTEGER)).filter((m) => keys.has(`${m.authorId}/${m.id}`));
      return client.sendReport(String(args.recipient), { reportId: String(args.reportId), reason: String(args.reason ?? ''), conversationId: String(args.conversationId), messages, reportedAccountId: args.reported ? String(args.reported) : undefined });
    }
    case 'folders': return client.folders();
    case 'saveFolders': return client.saveFolders(Array.isArray(args.folders) ? args.folders : []);
    case 'scheduledMessages': return client.scheduledMessages(args.conversationId ? String(args.conversationId) : undefined);
    case 'editScheduled': return client.editScheduled(String(args.id), { body: args.body === undefined ? undefined : String(args.body), dueAt: args.dueAt === undefined ? undefined : Number(args.dueAt) });
    case 'cancelScheduled': return client.cancelScheduled(String(args.id));
    case 'sendScheduledNow': await client.editScheduled(String(args.id), { dueAt: Date.now() + 1000 }); return client.sendDueScheduled(Date.now() + 2000);
    case 'acknowledge': return client.acknowledge(await target(args));
    case 'withdrawAcknowledgement': return client.withdrawAcknowledgement(await target(args));
    // A contact's security identity changed: the person reviewed (or dismissed) the warning.
    case 'acknowledgeIdentityChange': return client.acknowledgeIdentityChange(String(args.id));
    // Owners/admins who may review responses, with display names, for the composer picker.
    case 'ackReviewerCandidates': {
      const ids = (await client.ackReviewerCandidates(String(args.id))).filter((id) => id !== client!.accountId);
      return Promise.all(ids.map(async (id) => ({ accountId: id, name: await client!.displayName(id) })));
    }
    case 'canRequestAck': {
      const record = await client.groupRecord(String(args.id));
      return !!record?.community && !!record.adminOnly && ['owner', 'admin'].includes(record.members.find((m) => m.accountId === client!.accountId)?.role ?? '');
    }
    case 'memberLabels': {
      const record = await client.groupRecord(String(args.id));
      return Promise.all((record?.members ?? []).filter((m) => m.accountId !== client!.accountId).map(async (m) => ({ accountId: m.accountId, label: await client!.displayName(m.accountId) })));
    }
    case 'attach': {
      const bytes = fromBase64Url(args.data); const file = new File([bytes], String(args.name), { type: String(args.mime) });
      return args.voice ? client.sendVoiceNote(args.conversationId, file, Number(args.duration)) : client.sendAttachments(args.conversationId, [file], String(args.caption ?? ''), undefined, { viewOnce: args.viewOnce === true });
    }
    // View-once media (specs §30.4): returned to the native viewer once, never cached; then consumed.
    case 'openViewOnce': { const m = await target(args); const blob = await client.openViewOnce(m); return { data: toBase64Url(await blob.arrayBuffer()), mime: m.attachments?.[0]?.contentType }; }
    case 'consumeViewOnce': return client.consumeViewOnce(await target(args));
    case 'download': {
      const message = await target(args); const pointer = message.attachments?.[Number(args.index)]; if (!pointer) throw new Error('attachment unavailable');
      const blob = await client.downloadAttachment(pointer); return { data: toBase64Url(await blob.arrayBuffer()), name: pointer.fileName, mime: pointer.contentType };
    }
    case 'star': return client.setStarred(await target(args), Boolean(args.value));
    case 'react': return client.react(await target(args), String(args.emoji));
    // Polls (FR-EXT-01): the message snapshot carries poll state; voters' names are resolved here.
    case 'sendPoll': return client.sendPoll(String(args.conversationId), String(args.question), Array.isArray(args.options) ? args.options.map(String) : [], Boolean(args.multiple));
    case 'sendQuiz': return client.sendQuiz(String(args.conversationId), String(args.question), Array.isArray(args.options) ? args.options.map(String) : [], Number(args.correctIndex), args.explanation ? String(args.explanation) : undefined);
    // Bundled stickers: the manifest (with SHA-256 per file) is the core's; files ship in the APK.
    case 'stickerPacks': return STICKER_PACKS;
    case 'sendSticker': return client.sendSticker(String(args.conversationId), String(args.pack), String(args.id), { topic: args.topic ? String(args.topic) : undefined });
    // Personal stickers (WhatsApp): the collection syncs across own devices; bytes are verified by
    // SHA-256 (the sticker ID) before use. Images are made square 512 px WebP here, like on the web.
    // Key transparency (specs §19.4): the contact's keys checked against the witnessed log.
    case 'keyTransparency': return (await client.keyTransparency(String(args.id), args.force === true)) ?? null;
    case 'integrationParticipants': return client.integrationParticipants(String(args.id));
    case 'stickerCollection': return client.stickerCollection();
    case 'createSticker': return client.addCustomSticker(await makeStickerImage(new Blob([fromBase64Url(String(args.data))], { type: String(args.mime ?? 'image/*') })));
    case 'saveSticker': return client.saveSticker(await target(args));
    case 'removeSticker': return client.removeCustomSticker(String(args.id));
    case 'favoriteSticker': return client.toggleFavoriteSticker({ pack: String(args.pack), id: String(args.id) });
    case 'stickerBytes': {
      const bytes = await client.customStickerBytes({ id: String(args.id), attachment: args.attachment ?? undefined });
      return bytes ? toBase64Url(bytes) : null;
    }
    case 'votePoll': return client.votePoll(await target(args), Array.isArray(args.optionIds) ? args.optionIds.map(String) : []);
    case 'closePoll': return client.closePoll(await target(args));
    case 'canClosePoll': return client.canClosePoll(await target(args), client.accountId);
    // Events (FR-EXT-01): times are UTC milliseconds; the snapshot carries event state.
    case 'createEvent': return client.createEvent(String(args.conversationId), eventInput(args));
    case 'updateEvent': return client.updateEvent(await target(args), eventInput(args), args.cancelled === true);
    case 'rsvp': return client.rsvp(await target(args), args.response === 'maybe' ? 'maybe' : args.response === 'no' ? 'no' : 'going');
    case 'canEditEvent': return client.canEditEvent(await target(args), client.accountId);
    case 'eventResponders': {
      const event = (await target(args)).event; if (!event) return {};
      const named = async (id: string) => id === client!.accountId ? 'You' : client!.displayName(id);
      return Object.fromEntries(await Promise.all((['going', 'maybe', 'no'] as const).map(async (r) => [r, await Promise.all(Object.entries(event.rsvps).filter(([, x]) => x.response === r).map(([id]) => named(id)))])));
    }
    case 'eventIcs': { const m = await target(args); return m.event ? toIcs(m.event, `${m.authorId}.${m.id}`) : ''; }
    case 'pollVoters': {
      const poll = (await target(args)).poll; if (!poll) return {};
      const named = async (id: string) => id === client!.accountId ? 'You' : client!.displayName(id);
      return Object.fromEntries(await Promise.all(poll.options.map(async (o) => [o.id, await Promise.all(Object.entries(poll.votes).filter(([, b]) => b.optionIds.includes(o.id)).map(([id]) => named(id)))])));
    }
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
    case 'pushServers': return (deploymentInfo() ?? await loadDeploymentInfo()).push?.servers ?? [];
    case 'credentials': return client.credentialStatus(args.refresh === true);
    case 'pin': return client.setPinned(await target(args), Boolean(args.pinned));
    case 'canPin': return client.canPin(String(args.id));
    case 'createInvite': return client.createInviteLink(String(args.id));
    case 'revokeInvites': return client.revokeInviteLinks(String(args.id));
    case 'banMember': return client.banMember(String(args.id), String(args.accountId));
    case 'unbanMember': return client.unbanMember(String(args.id), String(args.accountId));
    case 'groupBans': return Promise.all((await client.groupBans(String(args.id))).map(async (accountId) => ({ accountId, label: await client!.displayName(accountId) })));
    case 'requestToJoin': return client.requestToJoin(String(args.token));
    case 'joinRequests': return Promise.all((await client.joinRequests(String(args.id))).map(async (r) => ({ ...r, label: await client!.displayName(r.accountId) })));
    case 'declineJoin': return client.declineJoinRequest(String(args.id), String(args.accountId));
    case 'leaveGroup': return client.leaveGroup(String(args.id));
    case 'acceptRequest': return client.acceptRequest(String(args.id));
    case 'setPushEndpoint': return args.endpoint ? context.api.setPushEndpoint(String(args.endpoint)) : context.api.clearPushEndpoint();
    case 'block': return client.setBlocked(String(args.id), Boolean(args.blocked));
    case 'setDisappearing': return client.setDisappearing(String(args.id), Number(args.seconds));
    case 'startCall': return client.startCall(String(args.conversationId), Boolean(args.video));
    case 'answerCall': {
      const invite = client.pendingInvite(String(args.callId)); if (!invite) throw new Error('call unavailable');
      return { join: await client.answerCall(invite), key: invite.key, generation: invite.generation ?? 0, video: invite.video };
    }
    case 'declineCall': { const invite = client.pendingInvite(String(args.callId)); if (invite) await client.declineCall(invite, Boolean(args.busy)); return; }
    case 'missCall': { const invite = client.pendingInvite(String(args.callId)); if (invite) await client.missCall(invite); return; }
    case 'communities': return client.communities();
    case 'createCommunity': return client.createCommunity(String(args.name), String(args.description ?? ''));
    case 'communityGroups': return client.communityGroups(await community(args.id));
    case 'communityMembers': return client.communityMembers(await community(args.id));
    case 'createCommunityGroup': return client.createCommunityGroup(await community(args.id), {
      name: String(args.name ?? ''), description: String(args.description ?? ''),
      memberIds: Array.isArray(args.memberIds) ? args.memberIds.map(String) : [],
      visibility: args.visibility === 'private' ? 'private' : 'discoverable', delegation: args.delegation !== false });
    case 'linkCommunityGroup': return client.linkGroupToCommunity(await community(args.id), String(args.conversationId), args.visibility === 'private' ? 'private' : 'discoverable', args.delegation === true);
    case 'acceptCommunityLink': return client.acceptCommunityLink(await community(args.id), String(args.groupId), args.delegation === true);
    case 'unlinkCommunityGroup': return client.unlinkCommunityGroup(await community(args.id), String(args.groupId));
    case 'onboarding': return client.onboarding(await community(args.id));
    case 'communityOperations': return client.communityOperations(await community(args.id));
    case 'retryCommunityOperations': return client.retryCommunityOperations(await community(args.id));
    case 'saveOnboarding': return client.saveOnboarding(await community(args.id), {
      welcome: String(args.welcome ?? ''), rules: String(args.rules ?? ''), ackRequired: args.ackRequired === true,
      recommended: Array.isArray(args.recommended) ? args.recommended.map(String) : [],
      checklist: Array.isArray(args.checklist) ? args.checklist.map((i: Record<string, unknown>) => ({ id: String(i.id), label: String(i.label), required: i.required === true })) : [] });
    case 'setChecklistItem': return client.setChecklistItem(await community(args.id), String(args.itemId), args.done === true);
    case 'acknowledgeRules': return client.acknowledgeRules(await community(args.id));
    case 'requestCommunityGroup': return client.requestCommunityGroup(await community(args.id), String(args.groupId));
    case 'rotateCallKey': return client.rotateCallKey(String(args.conversationId), String(args.callId), Number(args.after));
    case 'endCall': return client.endCall(String(args.callId), String(args.conversationId), Boolean(args.answered));
    case 'callLog': return client.callLog();
    case 'createCallLink': return client.createCallLink(String(args.id));
    case 'revokeCallLink': return client.revokeCallLink(String(args.token));
    // Member call links (AC-CALL-07): join the group's running call with the stored key, or ring it.
    case 'joinCallLink': {
      try { return await client.joinViaLink(String(args.token)); }
      catch (e) { if (e instanceof CallKeyUnavailableError) return { keyUnavailable: true }; throw e; }
    }
    case 'clearCallLog': return client.clearCallLog();
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
    case 'setSnooze': return client.setSnooze(String(args.id), args.until === null || args.until === undefined ? null : Number(args.until), args.zone ? String(args.zone) : undefined);
    case 'updateGroupInfo': return client.updateGroupInfo(String(args.id), { name: args.name === undefined ? undefined : String(args.name), description: args.description === undefined ? undefined : String(args.description) });
    case 'createGroup': { const members = await Promise.all((args.members as string[]).map((id) => client!.account(id))); if (members.some((m) => !m)) throw new Error('member unavailable'); return client.createGroup(String(args.name), members.filter((m) => Boolean(m)) as any, Boolean(args.channel)); }
    case 'addMembers': return client.addGroupMembers(args.id, args.members);
    case 'removeMember': return client.removeGroupMember(args.id, args.member);
    case 'role': return client.changeGroupRole(args.id, args.member, args.role);
    case 'verify': return client.setVerified(args.id, Boolean(args.verified));
    case 'identity': { const keys = await client.identityKeys(args.id); if (!keys.remote) return { verified: keys.verified }; return { verified: keys.verified, digits: safetyNumber(client.accountId, keys.local, args.id, keys.remote) }; }
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
    // Integration runtime: every message newer than `after` (sort key), oldest first, across all chats.
    case 'archiveSince': {
      const after = Number(args.after) || 0;
      const all = (await Promise.all(client.conversations().map(async (c) => (await client!.messages(c.id, 2000))
        .filter((m) => m.sort > after && !m.notice).map((m) => ({ ...publicMessage(m), conversationTitle: c.title, conversationKind: c.kind }))))).flat();
      const page = all.sort((a, b) => a.sort - b.sort).slice(0, 500);
      return Promise.all(page.map(async (m) => ({ ...m, authorName: await client!.displayName(m.authorId) })));
    }
    case 'logout': await client.signOutAndWipe(); client = null; active = null; context = await openContext(); emit('phase', { name: 'welcome' }); return;
    default: throw new Error('unsupported command');
  }
}
async function openContext(): Promise<LocalContext> {
  const store = await EncryptedStore.open();
  try { await loadDeploymentInfo(); await store.put('deployment-policy', 'attachment-limit', MAX_ATTACHMENT_BYTES); }
  catch { configureAttachmentLimit((await store.get<number>('deployment-policy', 'attachment-limit')) ?? 104857600); }
  return { store, repos: new Repositories(store), signal: new SignalStore(store), api: new AndroidApi(new HttpClient()) };
}
window.ConvoCore = { command(json: string) {
  if (json.length > 150 * 1024 * 1024) return;
  let request: { id: number; method: string; args?: Record<string, any> };
  try { request = JSON.parse(json); } catch { return; }
  void command(request.method, request.args ?? {}).then((value) => { emit('result', { id: request.id, ok: true, value }); refresh(); })
    .catch((e) => { emit('diagnostic', { stage: request.method, name: e instanceof Error ? e.name : 'unknown' }); emit('result', { id: request.id, ok: false, error: e instanceof LogoutRecoveryRequiredError ? 'recovery-required' : e instanceof EditNotAllowedError ? 'edit-not-allowed' : e instanceof SendRestrictedError ? (e.reason === 'slow' ? `slow-mode:${e.retryAt}` : 'send-restricted') : e instanceof ApiError ? e.code : 'operation-failed' }); });
} };
void (async () => { context = await openContext(); await startClient(); })().catch(() => emit('phase', { name: 'error' }));

setInterval(() => { if (client && document.visibilityState === 'visible') void client.lastSeenHeartbeat().catch(() => undefined); }, 20000);

/** Acknowledgement request from the composer: false, true, or `{ due?, expires? }` (epoch ms). */
function ackOptions(value: unknown): boolean | { due?: number; expires?: number; reviewers?: string[] } {
  if (value === true) return true;
  if (!value || typeof value !== 'object') return false;
  const { due, expires, reviewers } = value as Record<string, unknown>;
  const time = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined);
  return { ...(time(due) ? { due: time(due) } : {}), ...(time(expires) ? { expires: time(expires) } : {}),
    ...(Array.isArray(reviewers) ? { reviewers: reviewers.map(String) } : {}) };
}
