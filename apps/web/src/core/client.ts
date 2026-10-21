import { configureRecovery } from './recovery';
import { isProfile, type UserProfile } from './profile';
import { AccountHistory, type HistoryStatus } from './history';
import { fold, matchesMessage } from './search';
import { ApiError, NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { GatewaySocket, type ConnectionState } from '../api/socket';
import type { AccountDto, CommunityDto, CommunityLinkDto, CredentialStatusDto, Directive, EnvelopeDto } from '../api/types';
import {
  CONTENT_VERSION,
  decodeContent,
  MAX_ATTACHMENTS,
  MAX_BODY_BYTES,
  type AttachmentPointer,
  newMessageId,
  type Content,
  type CallMessage,
  type DataMessage,
  type Quote,
  type CommunityMeta,
  type GroupMeta,
  type AckRequest,
  type AckResponse,
  type OnboardingPackage,
  type RulesAck,
} from '../crypto/content';
import type { SignalStore } from '../crypto/signalStore';
import { Emitter } from '../lib/emitter';
import { Mutex } from '../lib/mutex';
import { utf8, fromBase64Url, sha256, toBase64Url } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import { downloadAttachment, prepareFile, uploadAttachment, type PreparedFile, type UploadResume } from './attachments';
import { replenishPreKeys } from './enrollment';
import { GroupManager, type GroupRecord } from './groups';
import { approveRequest, describeRequest, type IncomingLinkRequest } from './linking';
import { groupConversationId, groupIdOf, isMuted, labelOf, STATUS_RANK, type ChatMessage, type Conversation, type DeviceState, type MessageStatus, type Settings } from './model';
import { acceptsEdit, canEdit, editableUntil, normalizeEditBody } from './editPolicy';
import { sanitizeAutoDownload } from './mediaPolicy';
import { EXPIRY_NS, expiryOp, isTimer, startExpiry, type ExpiryEntry } from './disappearing';
import { newMediaKey, nextStatus, RING_TIMEOUT_MS, supersedes, type CallEvent, type CallInvite, type CallJoin, type CallKey, type CallLogEntry } from './calls';
import { Outbox, type OutboxItem } from './outbox';
import { RecordNs, type Repositories } from './repositories';
import { SessionManager, UntrustedIdentityError } from './sessions';

/**
 * The browser protocol client (CORE-02 facade for the web UI).
 *
 * Owns the socket, the outbox and envelope processing, and exposes conversation/message state to
 * the UI through events. All protocol-state mutations run through one {@link Mutex}; the UI never
 * touches protocol tables directly.
 *
 * Processing contract (specs §8, §10): decrypt → commit plaintext + ratchet state + processed
 * marker in one transaction → ack. Duplicates (same envelope GUID or same author + message ID)
 * are acknowledged and dropped.
 */

export interface ClientEvents extends Record<string, unknown> {
  history: HistoryStatus;
  profiles: Map<string, UserProfile>;
  /** Conversation list changed. */
  conversations: Conversation[];
  /** Messages of a conversation changed. */
  messages: string;
  connection: ConnectionState;
  /** Someone is typing in a conversation (transient). */
  typing: { conversationId: string; until: number };
  /** Own device list changed. */
  devices: undefined;
  /** This device was revoked; local data has been wiped. */
  revoked: undefined;
  /** Group membership/roles changed (group ID). */
  groups: string;
  /** The first mailbox drain after start-up completed (server reported an empty queue). */
  synced: undefined;
  settings: Settings;
  /** Incoming ring or a call event from the other party / own devices. */
  call: CallEvent;
  /** Local call history changed. */
  callLog: undefined;
  /** Confirmed passkey registration changed. */
  credentials: boolean;
  /** A new incoming message that should alert (see `emitAlert`). */
  alert: { conversationId: string; authorId: string; messageId: string; mention: boolean; body?: string; attachment: boolean };
}

const TYPING_TTL_SECONDS = 10;
const OUTBOX_RETRY_MS = 15_000;

export class EnclaveClient extends Emitter<ClientEvents> {
  readonly socket: GatewaySocket;
  private readonly profileCache = new Map<string, UserProfile>();
  private historySync: AccountHistory | null = null;
  historyStatus: HistoryStatus = 'pending';
  private readonly mutex = new Mutex();
  private readonly sessions: SessionManager;
  /** MLS group membership and encryption. */
  readonly groups: GroupManager;
  private readonly outbox: Outbox;
  private readonly conversationCache = new Map<string, Conversation>();
  private readonly accountCache = new Map<string, Promise<AccountDto | undefined>>();
  private activeConversation: string | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private currentSettings: Settings;
  private hasSynced = false;

  /** The encrypted local store (browser passphrase lock settings). */
  get localStore(): EncryptedStore { return this.repos.store; }

  constructor(
    readonly device: DeviceState,
    private readonly api: EnclaveApi,
    private readonly repos: Repositories,
    private readonly signal: SignalStore,
    settings: Settings,
  ) {
    super();
    this.currentSettings = settings;
    this.socket = new GatewaySocket(async () => (await api.socketTicket()).ticket);
    this.sessions = new SessionManager(api, signal, device);
    this.groups = new GroupManager(api, repos.store, device);
    this.outbox = new Outbox(repos.store, this.sessions, this.groups, api, this.socket, device.accountId, {
      onAccepted: (item) => this.onOutboxAccepted(item),
      onFailed: (item, reason, error) => this.onOutboxFailed(item, reason, error),
    }, (task) => this.mutex.run(task));
  }

  /** Account ID of this device. */
  get accountId(): string {
    return this.device.accountId;
  }

  get settings(): Settings {
    return this.currentSettings;
  }

  /** Whether the initial mailbox drain completed. */
  get synced(): boolean {
    return this.hasSynced;
  }

  /** Loads local state and connects. */
  async start(): Promise<void> {
    for (const p of await this.repos.store.list<UserProfile>('profile')) this.profileCache.set(p.accountId, p);
    const identity = await this.signal.localIdentity();
    if (!identity) throw new Error('missing account identity');
    this.historySync = new AccountHistory(this.api, this.repos.store, this.accountId, this.device.deploymentId,
      () => this.mutex.run(async () => {
        for (const c of await this.repos.conversations()) this.conversationCache.set(c.id, c);
        for (const p of await this.repos.store.list<UserProfile>('profile')) this.profileCache.set(p.accountId, p);
        this.emit('profiles', this.profiles());
        this.emitConversations();
        for (const c of this.conversations()) this.emit('messages', c.id);
      }), (status) => { this.historyStatus = status; this.emit('history', status); }, (task) => this.mutex.run(task));
    await this.historySync.start(identity.identityPrivate);

    for (const c of await this.repos.conversations()) this.conversationCache.set(c.id, c);
    this.emitConversations();
    await this.repos.store.pruneProcessed();
    // Disappearing messages: sweep now and then periodically while the client runs.
    void this.sweepExpired().catch(() => undefined);
    void this.checkDeviceChanges().catch(() => undefined);
    this.expiryTimer = setInterval(() => void this.sweepExpired().catch(() => undefined), 30_000);
    this.socket.on('state', (state) => {
      this.emit('connection', state);
      if (state === 'online') { void this.outbox.flush(); void this.flushPendingUploads(); }
      if (state === 'revoked') void this.handleRevoked();
    });
    this.socket.on('envelope', (envelope) => void this.mutex.run(() => this.processEnvelope(envelope)).then(() => this.outbox.flush()));
    this.socket.on('directive', (directive) => void this.onDirective(directive));
    this.socket.on('queueEmpty', () => {
      // Envelopes are processed through the mutex; wait for them before declaring "synced".
      void this.mutex.run(async () => {
        if (!this.hasSynced) {
          this.hasSynced = true;
          this.emit('synced', undefined);
        }
      });
    });
    this.socket.start();
    this.retryTimer = setInterval(() => { void this.outbox.flush(); void this.flushPendingUploads(); }, OUTBOX_RETRY_MS);
    void this.maintainGroups();
  }

  /** Keeps MLS KeyPackages stocked and this account's devices in sync across groups. */
  private async maintainGroups(): Promise<void> {
    try {
      await this.mutex.run(() => this.groups.ensureKeyPackages());
      await this.syncOwnDevicesInGroups();
      await this.refreshAllGroups(); // completes removals that happened while this device was offline
    } catch (error) {
      console.warn('Group maintenance failed', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Re-reads every joined group's server state; pending departures (leaves, delegated community
   * removals) are then committed by one of the remaining members.
   */
  private async refreshAllGroups(): Promise<void> {
    for (const c of this.conversations()) {
      const groupId = groupIdOf(c.id);
      if (groupId && !c.left) await this.refreshGroup(groupId).catch(() => undefined);
    }
  }

  /** Adds linked own devices to (and removes revoked own devices from) every joined group. */
  private async syncOwnDevicesInGroups(): Promise<void> {
    const conversations = [...this.conversationCache.values()].filter((c) => c.kind === 'group' && !c.left);
    if (conversations.length === 0) return;
    const roster = await this.api.roster(this.accountId);
    const active = roster.devices.map((d) => d.deviceId);
    for (const c of conversations) {
      await this.mutex
        .run(() => this.groups.syncOwnDevices(groupIdOf(c.id)!, active))
        .catch((error) => console.warn('Own-device group sync failed', error instanceof Error ? error.message : error));
    }
  }

  /** Disconnects (tab closing / leadership lost). */
  stop(): void {
    clearInterval(this.expiryTimer);
    this.historySync?.stop();
    this.socket.stop();
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
  }

  // --- queries ----------------------------------------------------------------------------

  /** Conversations sorted: pinned first, then by latest activity. */
  conversations(): Conversation[] {
    return [...this.conversationCache.values()].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id),
    );
  }

  conversation(id: string): Conversation | undefined {
    return this.conversationCache.get(id);
  }

  /** Loads the newest messages of a conversation, ascending. */
  messages(conversationId: string, limit = 200, before?: number): Promise<ChatMessage[]> {
    return this.repos.messages(conversationId, limit, before);
  }

  /** Search every locally stored message, including history outside the rendered page. */
  async searchMessages(query: string): Promise<ChatMessage[]> {
    const q = fold(query);
    if (!q) return [];
    const results: ChatMessage[] = [];
    for (const conversation of this.conversations()) {
      const messages = await this.repos.messages(conversation.id, Number.MAX_SAFE_INTEGER);
      results.push(...messages.filter((m) => matchesMessage(m, q)));
    }
    return results.sort((a, b) => b.sort - a.sort);
  }

  /** Organization directory search (handles only). */
  searchDirectory(query: string): Promise<AccountDto[]> {
    return this.api.searchDirectory(query);
  }

  /** Safety-number inputs for a peer: local and remote identity keys. */
  async identityKeys(peerId: string): Promise<{ local: string; remote?: string; verified: boolean }> {
    const local = await this.signal.localIdentity();
    const peer = await this.signal.peerIdentity(peerId);
    return { local: local?.identityPublic ?? '', remote: peer?.identityKey, verified: peer?.verified ?? false };
  }

  // --- conversation commands --------------------------------------------------------------

  /** Opens (creating if needed) a direct conversation or Note to self. */
  async openConversation(peer: AccountDto): Promise<Conversation> {
    this.accountCache.set(peer.accountId, Promise.resolve(peer));
    const existing = this.conversationCache.get(peer.accountId);
    if (existing) return existing;
    const conversation = this.newConversation(peer.accountId, labelOf(peer));
    await this.repos.store.delete(RecordNs.localHiddenConversation, conversation.id);
    await this.saveConversations([conversation]);
    return conversation;
  }

  /** Marks a conversation as the one on screen and clears its unread count. */
  async setActiveConversation(id: string | null): Promise<void> {
    this.activeConversation = id;
    if (id) await this.markRead(id);
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation || (conversation.unread === 0 && !conversation.revisedUnread?.length)) return;
    // System notices (e.g. timer changes) are not counted as unread; skip them when collecting.
    const unread = conversation.unread ? (await this.repos.messages(conversationId, conversation.unread + 50)).filter((m) => !m.notice).slice(-conversation.unread) : [];
    // Messages edited after they were read need a read receipt for their new revision too.
    const revisedMessages = await Promise.all((conversation.revisedUnread ?? []).map((r) => this.repos.message(conversationId, r.authorId, r.id)));
    await this.saveConversations([{ ...conversation, unread: 0, revisedUnread: undefined, mentioned: undefined }]);
    const started = unread.filter((m) => m.direction === 'in' && m.expireTimer && !m.expiresAt).map((m) => startExpiry(m, Date.now()));
    if (started.length) await this.repos.store.commit(started.flatMap((m) => [this.repos.putMessage(m), expiryOp(m)!]));
    if (this.currentSettings.readReceipts && conversation.kind !== 'note' && !conversation.request) {
      const seen = new Map<string, ChatMessage>();
      for (const m of [...unread, ...revisedMessages]) if (m && m.direction === 'in' && !m.deleted) seen.set(`${m.authorId}/${m.id}`, m);
      const authors = new Set([...seen.values()].map((m) => m.authorId));
      for (const author of authors) {
        const messages = [...seen.values()].filter((m) => m.authorId === author);
        await this.enqueue(author, receipt('read', messages.map((m) => m.id), conversation.kind === 'group' ? conversationId : undefined, messages.map((m) => m.revision ?? 0)), false);
      }
    }
    if (unread.length > 0) {
      await this.enqueue(this.accountId, {
        v: CONTENT_VERSION,
        kind: 'sync',
        sync: { read: { conversationId, upTo: unread[unread.length - 1]!.sort } },
      }, false);
    }
  }

  async updateConversation(
    id: string,
    patch: Partial<Pick<Conversation, 'wallpaper' | 'pinned' | 'muted' | 'mutedUntil' | 'archived' | 'draft' | 'notify'>>,
  ): Promise<void> {
    // Serialized with envelope processing so a concurrent receipt cannot write back a stale copy.
    await this.mutex.run(async () => {
      const conversation = this.conversationCache.get(id);
      if (conversation) await this.saveConversations([{ ...conversation, ...patch }]);
    });
  }

  /**
   * Blocks or unblocks a direct contact. While blocked, their direct messages, calls, typing,
   * receipts and profile updates are dropped without acknowledgement content, and sending to them
   * is refused. The flag travels with the encrypted conversation archive to own devices.
   */
  async setBlocked(peerId: string, blocked: boolean): Promise<void> {
    await this.mutex.run(async () => {
      const conversation = this.conversationCache.get(peerId);
      if (!conversation || conversation.kind !== 'direct') throw new Error('only direct chats can be blocked');
      await this.saveConversations([{ ...conversation, blocked: blocked || undefined, blockedChangedAt: Date.now() }]);
    });
  }

  /** Accepts a message request: normal receipts/typing resume and the profile is shared. */
  async acceptRequest(conversationId: string): Promise<void> {
    await this.mutex.run(async () => {
      const conversation = this.conversationCache.get(conversationId);
      if (conversation?.request) await this.saveConversations([{ ...conversation, request: undefined }]);
    });
    const profile = this.profileCache.get(this.accountId);
    if (profile) await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'profile', profile }, false);
  }

  isBlocked(accountId: string): boolean { return !!this.conversationCache.get(accountId)?.blocked; }

  /** Acknowledges an identity change notice after the user reviewed it. */
  async acknowledgeIdentityChange(peerId: string): Promise<void> {
    const conversation = this.conversationCache.get(peerId);
    if (conversation) await this.saveConversations([{ ...conversation, identityChangedAt: undefined }]);
  }

  /** Records out-of-band verification of a peer's safety number. */
  async setVerified(peerId: string, verified: boolean): Promise<void> {
    await this.signal.setVerified(peerId, verified);
    await this.acknowledgeIdentityChange(peerId);
    // Release messages blocked by the identity change.
    if (verified) {
      for (const item of await this.blockedItems(peerId)) await this.outbox.retry(item.id);
    }
  }

  // --- message commands -------------------------------------------------------------------

  /**
   * Sends a text message. It is persisted as `queued` immediately (offline composition) and
   * delivered by the outbox.
   *
   * @throws Error if the body is empty or exceeds 64 KiB
   */
  async sendText(conversationId: string, body: string, quote?: Quote, mentions?: string[], requestAck = false): Promise<void> {
    await this.sendMessage(conversationId, { body, quote, mentions, requestAck });
  }

  /**
   * Encrypts and uploads files, then sends them (with an optional caption) as one message.
   * Uploads happen before the message is queued; a failed upload leaves nothing half-sent.
   *
   * @param onProgress called with the number of completed uploads
   */
  async sendAttachments(conversationId: string, files: File[], caption: string, onProgress?: (done: number) => void): Promise<void> {
    if (files.length === 0 || files.length > MAX_ATTACHMENTS) throw new Error('invalid attachment count');
    const prepared: PreparedFile[] = [];
    for (const file of files) prepared.push(await prepareFile(file));
    const pointers: AttachmentPointer[] = [];
    const resumes: (UploadResume | undefined)[] = [];
    try {
      for (const [i, file] of prepared.entries()) {
        pointers.push(await uploadAttachment(this.api, file, {}, { onResume: (r) => { resumes[i] = r; } }));
        onProgress?.(pointers.length);
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      // Offline: send when back online, keeping finished files and resumable progress.
      await this.queueUpload({ conversationId, caption, files: prepared, pointers, resumes });
      return;
    }
    await this.sendMessage(conversationId, { body: caption, attachments: pointers });
  }

  /**
   * Offline-queued upload (FEAT-01): keeps the prepared files in the encrypted local store and shows
   * a "waiting to upload" placeholder that already has the final message ID, so the eventual send
   * replaces it and can never duplicate it.
   */
  private async queueUpload(upload: { conversationId: string; caption: string; files: PreparedFile[]; voice?: { durationMs: number };
    pointers?: AttachmentPointer[]; resumes?: (UploadResume | undefined)[] }): Promise<void> {
    // File bytes are stored as base64url: the encrypted store serializes values as JSON.
    const entry: PendingUpload = { conversationId: upload.conversationId, caption: upload.caption, voice: upload.voice, id: newMessageId(), createdAt: Date.now(),
      files: upload.files.map((f, i) => ({ ...f, data: toBase64Url(f.data), pointer: upload.pointers?.[i], resume: upload.resumes?.[i] })) };
    const placeholder: ChatMessage = { conversationId: upload.conversationId, id: entry.id, authorId: this.accountId, direction: 'out',
      body: upload.caption.trim() || undefined, sentAt: entry.createdAt, sort: entry.createdAt, status: 'queued', reactions: {},
      pendingFiles: upload.files.map((f) => ({ name: f.fileName, size: f.data.byteLength, contentType: f.contentType })) };

    await this.repos.store.commit([{ type: 'put', ns: RecordNs.pendingUploads, id: entry.id, value: entry }, this.repos.putMessage(placeholder)]);
    this.emit('messages', upload.conversationId);
  }

  private uploading = false;
  /** Uploads queued files once the network is back; stops at the first network failure. */
  async flushPendingUploads(): Promise<void> {
    if (this.uploading) return;
    this.uploading = true;
    try {
      const pending = (await this.repos.store.list<PendingUpload>(RecordNs.pendingUploads)).sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of pending) {
        const pointers: AttachmentPointer[] = [];
        try {
          for (const file of entry.files) {
            if (file.pointer) { pointers.push(file.pointer); continue; }
            // Progress is saved as it happens so a later attempt resumes instead of restarting.
            const save = async (changes: Partial<PendingUpload['files'][number]>) => {
              Object.assign(file, changes);
              await this.repos.store.put(RecordNs.pendingUploads, entry.id, entry);
            };
            const { pointer: _p, resume, ...prepared } = file;
            const pointer = await uploadAttachment(this.api, { ...prepared, data: fromBase64Url(file.data) as Uint8Array<ArrayBuffer> },
              entry.voice ? { voiceNote: true, durationMs: entry.voice.durationMs } : {}, { resume, onResume: (r) => save({ resume: r }) });
            await save({ pointer, resume: undefined });
            pointers.push(pointer);
          }
        } catch (error) {
          if (error instanceof NetworkError) return;
          // A permanent failure (e.g. policy limit) leaves a failed placeholder instead of retrying forever.
          const placeholder = await this.repos.message(entry.conversationId, this.accountId, entry.id);
          await this.repos.store.commit([{ type: 'delete', ns: RecordNs.pendingUploads, id: entry.id },
            ...(placeholder ? [this.repos.putMessage({ ...placeholder, status: 'failed', error: 'UPLOAD_FAILED' })] : [])]);
          this.emit('messages', entry.conversationId);
          continue;
        }
        await this.sendMessage(entry.conversationId, { body: entry.caption, attachments: pointers }, entry.id);
        await this.repos.store.delete(RecordNs.pendingUploads, entry.id);
      }
    } finally { this.uploading = false; }
  }

  /** Encrypts, uploads and sends a recorded voice note. */
  async sendVoiceNote(conversationId: string, file: File, durationMs: number): Promise<void> {
    const prepared = await prepareFile(file);
    let pointer: AttachmentPointer;
    try { pointer = await uploadAttachment(this.api, prepared, { voiceNote: true, durationMs }); }
    catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      await this.queueUpload({ conversationId, caption: '', files: [prepared], voice: { durationMs } });
      return;
    }
    await this.sendMessage(conversationId, { attachments: [pointer] });
  }

  /** Mutes notifications until a time (`Infinity` = always) or unmutes (`null`). */
  async setMute(conversationId: string, until: number | null): Promise<void> {
    await this.updateConversation(conversationId, { muted: until !== null, mutedUntil: until === null || until === Infinity ? undefined : until });
  }

  /** Deletes all messages of a conversation on this device (other participants keep theirs). */
  async clearConversation(conversationId: string): Promise<void> {
    await this.mutex.run(async () => {
      const messages = await this.repos.messages(conversationId, Number.MAX_SAFE_INTEGER);
      const conversation = this.conversationCache.get(conversationId);
      await this.repos.store.commit([...messages.flatMap((m) => this.repos.localDeletion(m)),
        { type: 'put', ns: RecordNs.localHiddenConversation, id: conversationId, value: 'cleared' },
        ...(conversation ? [this.repos.putConversation({ ...conversation, preview: undefined, unread: 0 })] : [])]);
      if (conversation) this.conversationCache.set(conversationId, { ...conversation, preview: undefined, unread: 0 });
      this.emitConversations(); this.emit('messages', conversationId);
    });
  }

  /** Removes known local messages; future unseen messages remain eligible for delivery. */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.mutex.run(async () => {
      const messages = await this.repos.messages(conversationId, Number.MAX_SAFE_INTEGER);
      await this.repos.store.commit([...messages.flatMap((m) => this.repos.localDeletion(m)),
        { type: 'put', ns: RecordNs.localHiddenConversation, id: conversationId, value: 'deleted' },
        { type: 'delete', ns: RecordNs.conversation, id: conversationId }]);
      this.conversationCache.delete(conversationId); this.emitConversations(); this.emit('messages', conversationId);
    });
  }

  /** Downloads and decrypts an attachment of a message. */
  downloadAttachment(pointer: AttachmentPointer): Promise<Blob> {
    return downloadAttachment(this.api, pointer);
  }

  /**
   * Forwards a message to one destination conversation (specs §30.8: explicit single-destination
   * forwarding). Content is re-sent as new E2EE content marked "Forwarded"; the original
   * conversation is not referenced.
   */
  async forward(message: ChatMessage, destinationConversationId: string): Promise<void> {
    if (message.deleted || message.unsupported || message.undecryptable) throw new Error('nothing to forward');
    await this.sendMessage(destinationConversationId, { body: message.body, attachments: message.attachments, forwarded: true });
  }

  /** Stars/unstars a message on this device only. */
  async setStarred(message: ChatMessage, starred: boolean): Promise<void> {
    await this.mutex.run(async () => {
      const current = await this.repos.message(message.conversationId, message.authorId, message.id);
      if (!current || current.deleted) return;
      await this.repos.store.commit([this.repos.putMessage({ ...current, starred })]);
      this.emit('messages', message.conversationId);
    });
  }

  private async sendMessage(
    conversationId: string,
    content: { body?: string; quote?: Quote; attachments?: AttachmentPointer[]; forwarded?: boolean; mentions?: string[]; requestAck?: boolean },
    /** Reuse an existing ID (offline-queued upload placeholder) so the real message replaces it. */
    messageId?: string,
  ): Promise<void> {
    const text = content.body?.trim() || undefined;
    if (!text && !content.attachments?.length) throw new Error('empty message');
    if (this.isBlocked(conversationId)) throw new ContactBlockedError();
    if (this.conversationCache.get(conversationId)?.request) await this.acceptRequest(conversationId); // replying accepts
    if (text && utf8(text).length > MAX_BODY_BYTES) throw new Error('message too long');
    const groupId = groupIdOf(conversationId);
    const group = groupId ? await this.groups.record(groupId) : undefined;
    const recipients = group ? group.members.map((m) => m.accountId).filter((id) => id !== this.accountId) : conversationId !== this.accountId ? [conversationId] : [];
    const data: DataMessage = {
      recipientAccountIds: recipients,
      messageId: messageId ?? newMessageId(),
      timestamp: Date.now(),
      body: text,
      quote: content.quote,
      attachments: content.attachments,
      forwarded: content.forwarded || undefined,
      profile: this.profileCache.get(this.accountId),
      expireTimer: this.conversationCache.get(conversationId)?.expireSeconds || undefined,
      // Mentions only make sense in groups and only for current members.
      mentions: group && content.mentions?.length ? [...new Set(content.mentions)].filter((id) => recipients.includes(id)).slice(0, 50) : undefined,
      ackRequest: content.requestAck && group ? this.newAckRequest(group, recipients) : undefined,
    };
    const message: ChatMessage = {
      conversationId,
      recipientAccountIds: recipients,
      id: data.messageId,
      authorId: this.accountId,
      direction: 'out',
      body: text,
      attachments: content.attachments,
      forwarded: content.forwarded || undefined,
      quote: content.quote,
      sentAt: data.timestamp,
      sort: data.timestamp,
      status: 'queued',
      reactions: {},
      expireTimer: data.expireTimer,
      expiresAt: data.expireTimer ? data.timestamp + data.expireTimer * 1000 : undefined,
      mentions: data.mentions,
      ackRequest: data.ackRequest,
    };
    const conversation = this.conversationCache.get(conversationId);
    const ops: StoreOp[] = [this.repos.putMessage(message)];
    const expiry = expiryOp(message); if (expiry) ops.push(expiry);
    if (conversation) {
      const updated = { ...conversation, lastActivity: data.timestamp, preview: previewOf(data), previewFromMe: true, previewAuthor: this.accountId, draft: undefined, archived: false };
      ops.push(this.repos.putConversation(updated));
      this.conversationCache.set(conversationId, updated);
    }
    await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, { conversationId, id: data.messageId }, ops);
    this.emit('messages', conversationId);
    this.emitConversations();
  }

  // --- shared pins ------------------------------------------------------------------------

  /** One stored message (e.g. a pinned target). */
  message(conversationId: string, authorId: string, id: string): Promise<ChatMessage | undefined> {
    return this.repos.message(conversationId, authorId, id);
  }

  /**
   * Decides whether a new incoming message should alert, after it was committed. Muted chats never
   * alert; "mentions only" groups alert when a verified structured mention names this account. The
   * UI applies device settings, visibility, locks and the preview level.
   */
  private emitAlert(conversationId: string, authorId: string, data: DataMessage): void {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation || isMuted(conversation) || conversation.blocked) return;
    const mention = !!data.mentions?.includes(this.accountId) && !!groupIdOf(conversationId);
    if (conversation.kind === 'group' && conversation.notify === 'mentions' && !mention) return;
    this.emit('alert', { conversationId, authorId, messageId: data.messageId, mention, body: data.body, attachment: !!data.attachments?.length });
  }

  /** Whether this account may pin in a chat (groups/channels: owners and admins). */
  async canPin(conversationId: string): Promise<boolean> {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation || conversation.left || conversation.blocked) return false;
    const groupId = groupIdOf(conversationId);
    return !groupId || this.canChangeTimer(groupId, this.accountId);
  }

  /** Pins/unpins a message for everyone in the chat (at most {@link MAX_PINNED}; oldest drops off). */
  async setPinned(target: ChatMessage, pinned: boolean): Promise<void> {
    if (target.deleted || target.notice || !(await this.canPin(target.conversationId))) throw new Error('cannot pin');
    await this.mutex.run(async () => {
      const now = Date.now();
      const data: DataMessage = { messageId: newMessageId(), timestamp: now, pin: { targetMessageId: target.id, targetAuthorId: target.authorId, pinned } };
      const conversation = this.conversationCache.get(target.conversationId)!;
      const updated = { ...conversation, pinnedMessages: withPin(conversation.pinnedMessages, target.authorId, target.id, pinned, now, this.accountId) };
      this.conversationCache.set(updated.id, updated);
      await this.enqueue(target.conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, undefined, [this.repos.putConversation(updated)]);
    });
    this.emitConversations();
  }

  private async applyPin(conversation: Conversation, authorId: string, data: DataMessage, ops: StoreOp[]): Promise<'mutation' | 'ignored'> {
    const groupId = groupIdOf(conversation.id);
    if (groupId && !(await this.canChangeTimer(groupId, authorId))) return 'ignored';
    const pin = data.pin!;
    const target = await this.repos.message(conversation.id, pin.targetAuthorId, pin.targetMessageId);
    // Pins cannot resurrect deleted content; unpinning unknown targets is harmless.
    if (pin.pinned && (!target || target.deleted)) return 'ignored';
    this.stage(ops, { ...conversation, pinnedMessages: withPin(conversation.pinnedMessages, pin.targetAuthorId, pin.targetMessageId, pin.pinned, data.timestamp, authorId) });
    return 'mutation';
  }

  /** Adds or removes the current account's reaction. */
  async react(target: ChatMessage, emoji: string): Promise<void> {
    const remove = (target.reactions[emoji] ?? []).includes(this.accountId);
    const data: DataMessage = {
      messageId: newMessageId(),
      timestamp: Date.now(),
      reaction: { targetMessageId: target.id, targetAuthorId: target.authorId, emoji, remove },
    };
    const updated = applyReaction(target, this.accountId, emoji, remove);
    await this.enqueue(target.conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, undefined, [this.repos.putMessage(updated)]);
    this.emit('messages', target.conversationId);
  }

  // --- disappearing messages ---------------------------------------------------------------

  /**
   * Changes a chat's disappearing-message timer for everyone in it. Groups and channels: owners
   * and admins only (receivers enforce the same rule).
   */
  async setDisappearing(conversationId: string, seconds: number): Promise<void> {
    if (!isTimer(seconds)) throw new Error('unsupported timer');
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation || conversation.left) throw new Error('conversation unavailable');
    const groupId = groupIdOf(conversationId);
    if (groupId && !(await this.canChangeTimer(groupId, this.accountId))) throw new Error('only admins can change the timer');
    await this.mutex.run(async () => {
    const now = Date.now();
    const data: DataMessage = { messageId: newMessageId(), timestamp: now, timerUpdate: { seconds } };
    const notice: ChatMessage = { conversationId, id: data.messageId, authorId: this.accountId, direction: 'out', sentAt: now, sort: now, reactions: {}, notice: { kind: 'timer', seconds }, status: 'queued' };
    const updated = { ...this.conversationCache.get(conversationId)!, expireSeconds: seconds || undefined, expireUpdatedAt: now };
    this.conversationCache.set(conversationId, updated);
    await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, { conversationId, id: data.messageId },
      [this.repos.putMessage(notice), this.repos.putConversation(updated)]);
    });
    this.emit('messages', conversationId);
    this.emitConversations();
  }

  private async canChangeTimer(groupId: string, accountId: string): Promise<boolean> {
    const role = (await this.groups.record(groupId))?.members.find((m) => m.accountId === accountId)?.role;
    return role === 'owner' || role === 'admin';
  }

  private async applyTimerUpdate(conversation: Conversation, authorId: string, direction: 'in' | 'out', data: DataMessage, envelope: EnvelopeDto, ops: StoreOp[]): Promise<'mutation' | 'ignored'> {
    const seconds = data.timerUpdate!.seconds;
    if (!isTimer(seconds)) return 'ignored';
    const groupId = groupIdOf(conversation.id);
    if (groupId && !(await this.canChangeTimer(groupId, authorId))) return 'ignored';
    if (await this.repos.message(conversation.id, authorId, data.messageId)) return 'ignored';
    ops.push(this.repos.putMessage({ conversationId: conversation.id, id: data.messageId, authorId, direction, sentAt: data.timestamp,
      sort: direction === 'out' ? data.timestamp : envelope.serverTimestamp, reactions: {}, notice: { kind: 'timer', seconds }, status: direction === 'out' ? 'sent' : undefined }));
    // Last writer wins by sender time; ties broken by author ID for convergence.
    const newer = data.timestamp > (conversation.expireUpdatedAt ?? 0);
    if (newer) this.stage(ops, { ...conversation, expireSeconds: seconds || undefined, expireUpdatedAt: data.timestamp });
    return 'mutation';
  }

  /** Deletes messages whose deadline passed (suppression markers keep them from returning). */
  async sweepExpired(now = Date.now()): Promise<void> {
    await this.mutex.run(async () => {
      const due = (await this.repos.store.list<ExpiryEntry>(EXPIRY_NS)).filter((e) => e.expiresAt <= now);
      if (!due.length) return;
      const ops: StoreOp[] = [];
      const touched = new Set<string>();
      for (const entry of due) {
        ops.push(...this.repos.localDeletion(entry as unknown as ChatMessage), { type: 'delete', ns: EXPIRY_NS, id: JSON.stringify([entry.conversationId, entry.authorId, entry.id]) });
        touched.add(entry.conversationId);
      }
      await this.repos.store.commit(ops);
      // Never leave expired text in the chat list preview.
      const previews: Conversation[] = [];
      for (const id of touched) {
        const c = this.conversationCache.get(id);
        const [latest] = await this.repos.messages(id, 1);
        if (c) previews.push({ ...c, preview: latest ? previewOf({ messageId: latest.id, timestamp: latest.sentAt, body: latest.body, attachments: latest.attachments }) : '' });
      }
      if (previews.length) await this.saveConversations(previews);
      for (const id of touched) this.emit('messages', id);
    });
  }

  // --- calls ------------------------------------------------------------------------------

  private expiryTimer: ReturnType<typeof setInterval> | undefined;

  /** Pending incoming rings (with their media key) until answered, declined or timed out. */
  private readonly invites = new Map<string, CallInvite>();

  /**
   * Starts a call: the server authorizes the room, then an E2EE ring with a fresh media key goes
   * to the peer (and this account's other devices) or to the group.
   */
  async startCall(conversationId: string, video: boolean): Promise<{ join: CallJoin; key: string }> {
    const conversation = this.conversationCache.get(conversationId);
    if (!conversation || conversation.kind === 'note' || conversation.left || conversation.adminOnly || conversation.blocked) throw new Error('calls unavailable here');
    const groupId = groupIdOf(conversationId);
    const join = await this.api.createCall(groupId ? { groupId, video } : { peer: conversationId, video });
    const key = newMediaKey();
    await this.logCall({ callId: join.callId, conversationId, direction: 'out', peer: conversationId, video, startedAt: Date.now(), status: 'ringing' });
    await this.sendCall(conversationId, { callId: join.callId, action: 'ring', video, key, to: groupId ? undefined : conversationId, timestamp: Date.now() });
    return { join, key };
  }

  /**
   * Group calls: replaces the media key after a participant left (ADR-0006). The new key goes
   * through the MLS group, so a member removed from the group cannot decrypt the call any more.
   * The caller applies the returned key locally right away.
   */
  async rotateCallKey(conversationId: string, callId: string, after: number): Promise<CallKey> {
    if (!groupIdOf(conversationId)) throw new Error('rekey is for group calls');
    const next: CallKey = { key: newMediaKey(), generation: after + 1 };
    await this.sendCall(conversationId, { callId, action: 'rekey', key: next.key, generation: next.generation, timestamp: Date.now() });
    return next;
  }

  /** Answers a ring; other own devices stop ringing when they receive the accept. */
  async answerCall(invite: CallInvite): Promise<CallJoin> {
    const join = await this.api.joinCall(invite.callId);
    this.invites.delete(invite.callId);
    await this.updateCallLog(invite.callId, { status: 'answered', answeredAt: Date.now() });
    await this.sendCall(invite.conversationId, { callId: invite.callId, action: 'accept', to: invite.group ? undefined : invite.from, timestamp: Date.now() });
    return join;
  }

  /** Declines (or reports busy for) a ring. */
  async declineCall(invite: CallInvite, busy = false): Promise<void> {
    this.invites.delete(invite.callId);
    await this.updateCallLog(invite.callId, { status: busy ? 'missed' : 'declined', endedAt: Date.now() });
    // A group ring is not declined for everyone: only direct calls tell the caller.
    if (!invite.group) await this.sendCall(invite.conversationId, { callId: invite.callId, action: busy ? 'busy' : 'decline', to: invite.from, timestamp: Date.now() });
  }

  /**
   * Leaves a call. Direct calls end for both sides (`cancel` before an answer, `end` after); a
   * group call only ends for this device.
   */
  async endCall(callId: string, conversationId: string, answered: boolean): Promise<void> {
    await this.updateCallLog(callId, { status: answered ? 'ended' : 'cancelled', endedAt: Date.now() });
    if (groupIdOf(conversationId)) {
      // Stop the others ringing if nobody answered a group call yet; otherwise just leave.
      const entry = await this.repos.store.get<CallLogEntry>(RecordNs.callLog, callId);
      if (!answered && entry?.direction === 'out') await this.sendCall(conversationId, { callId, action: 'cancel', timestamp: Date.now() });
      return;
    }
    await this.sendCall(conversationId, { callId, action: answered ? 'end' : 'cancel', to: conversationId, timestamp: Date.now() });
    await this.api.endCall(callId).catch(() => undefined);
  }

  /** A ring that timed out unanswered on this device (no message is sent). */
  async missCall(invite: CallInvite): Promise<void> {
    this.invites.delete(invite.callId);
    const entry = await this.repos.store.get<CallLogEntry>(RecordNs.callLog, invite.callId);
    if (entry?.status === 'ringing') await this.updateCallLog(invite.callId, { status: 'missed', endedAt: Date.now() });
  }

  /** Fresh join token for an ongoing call (reconnect after network loss). */
  rejoinCall(callId: string): Promise<CallJoin> { return this.api.joinCall(callId); }

  pendingInvite(callId: string): CallInvite | undefined { return this.invites.get(callId); }

  async callLog(): Promise<CallLogEntry[]> {
    return (await this.repos.store.list<CallLogEntry>(RecordNs.callLog)).sort((a, b) => b.startedAt - a.startedAt);
  }

  async clearCallLog(): Promise<void> {
    await this.repos.store.commit((await this.callLog()).map((e) => ({ type: 'delete' as const, ns: RecordNs.callLog, id: e.callId })));
    this.emit('callLog', undefined);
  }

  private async sendCall(conversationId: string, call: CallMessage): Promise<void> {
    // Rings are urgent so an offline phone is woken to ring (content-free push; MSG-02).
    await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'call', call }, !groupIdOf(conversationId), undefined, [], false, call.action === 'ring');
  }

  private async logCall(entry: CallLogEntry, ops?: StoreOp[]): Promise<void> {
    const op: StoreOp = { type: 'put', ns: RecordNs.callLog, id: entry.callId, value: entry };
    if (ops) ops.push(op); else { await this.repos.store.commit([op]); this.emit('callLog', undefined); }
  }

  private async updateCallLog(callId: string, patch: Partial<CallLogEntry>): Promise<void> {
    const current = await this.repos.store.get<CallLogEntry>(RecordNs.callLog, callId);
    if (current) await this.logCall({ ...current, ...patch });
  }

  /**
   * Applies a received call message. `author` is the authenticated sender account; for direct
   * calls the conversation is the sender, or the callee named in `to` when an own device sent it.
   */
  private async applyCall(call: CallMessage, author: string, groupConversation: string | undefined, envelope: EnvelopeDto, ops: StoreOp[]): Promise<(() => Promise<void>)[]> {
    const fromSelf = author === this.accountId;
    const conversationId = groupConversation ?? (fromSelf ? call.to : author);
    if (!conversationId || conversationId === this.accountId) return [];
    if (call.action === 'rekey') {
      if (!groupConversation) return [];
      const next: CallKey = { key: call.key!, generation: call.generation! };
      // A not-yet-answered ring joins with the newest key.
      const invite = this.invites.get(call.callId);
      if (invite && supersedes({ key: invite.key, generation: invite.generation ?? 0 }, next)) { invite.key = next.key; invite.generation = next.generation; }
      return [async () => this.emit('call', { type: 'rekey', callId: call.callId, conversationId, ...next, fromSelf })];
    }
    const existing = await this.repos.store.get<CallLogEntry>(RecordNs.callLog, call.callId);
    if (call.action === 'ring') {
      if (existing) return [];
      if (fromSelf) {
        await this.logCall({ callId: call.callId, conversationId, direction: 'out', peer: conversationId, video: !!call.video, startedAt: envelope.serverTimestamp, status: 'ringing' }, ops);
        return [async () => this.emit('callLog', undefined)];
      }
      // Ring age uses server time so a late delivery after being offline becomes a missed call.
      const stale = Date.now() - envelope.serverTimestamp > RING_TIMEOUT_MS;
      await this.logCall({ callId: call.callId, conversationId, direction: 'in', peer: author, video: !!call.video, startedAt: envelope.serverTimestamp, status: stale ? 'missed' : 'ringing' }, ops);
      if (stale) return [async () => this.emit('callLog', undefined)];
      const invite: CallInvite = { callId: call.callId, conversationId, from: author, video: !!call.video, key: call.key!, at: envelope.serverTimestamp, group: !!groupConversation };
      return [async () => { this.invites.set(invite.callId, invite); this.emit('callLog', undefined); this.emit('call', { type: 'incoming', invite }); }];
    }
    // Direct calls: every event concerns this call. Group calls: only own devices, the caller's
    // cancel/end, or someone answering our own ring change local state.
    const relevant = !!existing && (!groupConversation || fromSelf
      || (existing.direction === 'out' ? call.action === 'accept' : author === existing.peer && (call.action === 'cancel' || call.action === 'end')));
    if (!existing || !relevant) return [];
    const status = nextStatus(existing.status, call.action, fromSelf, existing.direction);
    await this.logCall({ ...existing, status, ...(status === 'answered' && !existing.answeredAt ? { answeredAt: envelope.serverTimestamp } : {}),
      ...(status !== 'answered' && status !== 'ringing' ? { endedAt: existing.endedAt ?? envelope.serverTimestamp } : {}) }, ops);
    return [async () => {
      if (call.action !== 'accept' || fromSelf) this.invites.delete(call.callId);
      this.emit('callLog', undefined);
      this.emit('call', { type: 'remote', callId: call.callId, conversationId, from: author, action: call.action, fromSelf });
    }];
  }

  /** True while the author may still edit this message's text (see {@link canEdit}). */
  canEdit(message: ChatMessage, now = Date.now()): boolean {
    return canEdit(message, this.conversationCache.get(message.conversationId), this.accountId, now);
  }

  /** End of the edit window, or `undefined` when the message is not editable at all. */
  editableUntil(message: ChatMessage): number | undefined {
    return editableUntil(message, this.conversationCache.get(message.conversationId), this.accountId);
  }

  /**
   * Author edit of own text inside the deployment edit window. Each edit is a new content
   * revision: earlier delivery/read receipts no longer apply, and recipients acknowledge the new
   * revision separately. Unchanged or empty text is a no-op.
   */
  async edit(target: ChatMessage, body: string): Promise<void> {
    const current = await this.repos.message(target.conversationId, target.authorId, target.id) ?? target;
    if (!this.canEdit(current)) throw new EditNotAllowedError();
    const text = normalizeEditBody(current, body);
    if (!text) return;
    const now = Date.now();
    const revision = (current.revision ?? 0) + 1;
    const data: DataMessage = { messageId: newMessageId(), timestamp: now, edit: { targetMessageId: current.id, body: text, revision } };
    const conversation = this.conversationCache.get(current.conversationId);
    const preview = conversation && await this.withEditedPreview(conversation, current, text);
    await this.enqueue(current.conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, undefined, [
      this.repos.putMessage(revised(current, text, now, revision)),
      ...(preview && preview !== conversation ? [this.repos.putConversation(preview)] : []),
    ]);
    if (preview && preview !== conversation) { this.conversationCache.set(preview.id, preview); this.emitConversations(); }
    this.emit('messages', current.conversationId);
  }

  /** Delete for everyone (author only); leaves a tombstone. */
  async deleteForEveryone(target: ChatMessage): Promise<void> {
    if (target.authorId !== this.accountId) throw new Error('only the author can delete for everyone');
    const data: DataMessage = { messageId: newMessageId(), timestamp: Date.now(), delete: { targetMessageId: target.id } };
    await this.enqueue(target.conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, undefined, [
      this.repos.putMessage(tombstone(target)),
    ]);
    this.emit('messages', target.conversationId);
  }

  // --- groups -----------------------------------------------------------------------------

  /** Creates an MLS group, then shares its encrypted name with the members. */
  async createGroup(name: string, members: AccountDto[], adminOnly = false): Promise<Conversation> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 128) throw new Error('invalid group name');
    const record = await this.mutex.run(() => this.groups.create(trimmed, members.map((m) => m.accountId), adminOnly));
    members.forEach((m) => this.accountCache.set(m.accountId, Promise.resolve(m)));
    const conversation = { ...this.newGroupConversation(record.groupId, trimmed), adminOnly };
    await this.saveConversations([conversation]);
    await this.shareGroupMeta(record);
    return conversation;
  }

  /** Local group record (encrypted name, roles from the server mirror). */
  async groupRecord(conversationId: string): Promise<GroupRecord | undefined> {
    const id = groupIdOf(conversationId) ?? '';
    const record = await this.groups.record(id);
    return record ? { ...record, needsJoin: !await this.groups.isJoined(id) } : undefined;
  }

  async changeGroupRole(conversationId: string, accountId: string, role: import('../api/types').GroupRole): Promise<void> {
    const id = groupIdOf(conversationId)!;
    await this.mutex.run(() => this.groups.changeRole(id, accountId, role));
    this.emit('groups', id);
  }

  /** Display name of an account (cached directory lookup). */
  async displayName(accountId: string): Promise<string> {
    if (accountId === this.accountId) return labelOf(this.device);
    const account = await this.lookupAccount(accountId);
    return account ? labelOf(account) : 'Unknown';
  }

  /** Directory entry of an account (cached), e.g. for the contact info panel. */
  account(accountId: string): Promise<AccountDto | undefined> {
    if (accountId === this.accountId) {
      return Promise.resolve({ accountId, username: this.device.username, displayName: this.device.displayName });
    }
    return this.lookupAccount(accountId);
  }

  /** Adds people to a group (admins/owners). */
  async addGroupMembers(conversationId: string, accountIds: string[]): Promise<void> {
    const groupId = groupIdOf(conversationId)!;
    await this.mutex.run(() => this.groups.addMembers(groupId, accountIds));
    const record = await this.groups.record(groupId);
    if (record) await this.shareGroupMeta(record);
    this.emit('groups', groupId);
  }

  /** Removes a person from a group (admins/owners). */
  /**
   * Leaves a group or channel. A notice goes to the members first; the server then removes this
   * account from the ACL and stops fan-out. A remaining member completes the MLS removal. The last
   * owner must make someone else owner first (server-enforced).
   */
  async leaveGroup(conversationId: string): Promise<void> {
    const groupId = groupIdOf(conversationId);
    if (!groupId) throw new Error('not a group');
    await this.mutex.run(async () => {
      await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'data', data: { messageId: newMessageId(), timestamp: Date.now(), left: true } }, false);
    });
    await this.outbox.flush();
    await this.api.leaveGroup(groupId);
    await this.mutex.run(async () => {
      const record = await this.groups.record(groupId);
      if (record) await this.groups.markLeft(groupId);
      const conversation = this.conversationCache.get(conversationId);
      if (conversation) await this.saveConversations([{ ...conversation, left: true }]);
    });
    this.emit('groups', groupId);
  }

  // --- invite links (GRP-03) -----------------------------------------------------------------

  /** New invite link for a group/channel (owners/admins). The token is shown once; only its hash is stored. */
  async createInviteLink(conversationId: string): Promise<{ url: string; expiresAt: string }> {
    const { token, expiresAt } = await this.api.createInvite(groupIdOf(conversationId)!);
    return { url: `${window.location.origin}/#/join/${token}`, expiresAt };
  }
  revokeInviteLinks(conversationId: string): Promise<void> { return this.api.revokeInvites(groupIdOf(conversationId)!); }
  /** Files a join request; admins approve by adding this account. Reveals nothing about the group. */
  requestToJoin(token: string): Promise<void> { return this.api.requestToJoin(token); }
  /** Bans an account (no join requests or re-adds) and removes it if it is a member. */
  async banMember(conversationId: string, accountId: string): Promise<void> {
    await this.api.banMember(groupIdOf(conversationId)!, accountId);
    const record = await this.groups.record(groupIdOf(conversationId)!);
    if (record?.members.some((m) => m.accountId === accountId)) await this.removeGroupMember(conversationId, accountId);
  }
  unbanMember(conversationId: string, accountId: string): Promise<void> { return this.api.unbanMember(groupIdOf(conversationId)!, accountId); }
  groupBans(conversationId: string): Promise<string[]> { return this.api.groupBans(groupIdOf(conversationId)!); }
  joinRequests(conversationId: string) { return this.api.joinRequests(groupIdOf(conversationId)!); }
  declineJoinRequest(conversationId: string, accountId: string): Promise<void> { return this.api.declineJoin(groupIdOf(conversationId)!, accountId); }

  /**
   * Security notices (ID-02): compares this account's device list with the last one seen and
   * records "device linked/removed" notices in Note to self. Notice IDs are deterministic, so every
   * own device writes the same entries and the archive does not duplicate them. The first run only
   * records a baseline.
   */
  async checkDeviceChanges(): Promise<void> {
    const devices = await this.api.devices();
    await this.mutex.run(async () => {
      const known = await this.repos.store.get<{ id: number; platform: string }[]>(RecordNs.knownDevices, 'self');
      const current = devices.map((d) => ({ id: d.deviceId, platform: d.platform }));
      const ops: StoreOp[] = [{ type: 'put', ns: RecordNs.knownDevices, id: 'self', value: current }];
      if (known) {
        const now = Date.now();
        const changes = [
          ...current.filter((d) => !known.some((k) => k.id === d.id)).map((d) => ({ ...d, change: 'added' as const })),
          ...known.filter((k) => !current.some((d) => d.id === k.id)).map((d) => ({ ...d, change: 'removed' as const })),
        ];
        if (changes.length) {
          const note = await this.ensureConversation(this.accountId, ops);
          for (const [i, c] of changes.entries()) {
            ops.push(this.repos.putMessage({ conversationId: note.id, id: `device-${c.change}-${c.id}`, authorId: this.accountId, direction: 'out',
              sentAt: now + i, sort: now + i, reactions: {}, notice: { kind: 'device', change: c.change, deviceId: c.id, platform: c.platform } }));
          }
          this.stage(ops, { ...this.conversationCache.get(note.id)!, lastActivity: now, unread: this.conversationCache.get(note.id)!.unread + changes.length });
        }
      }
      await this.repos.store.commit(ops);
      if (known && ops.length > 1) { this.emit('messages', this.accountId); this.emitConversations(); }
    });
  }

  /** Remaining members remove the MLS leaves of people who left (first one wins; races retry later). */
  private async completeDepartures(groupId: string, departed: string[]): Promise<void> {
    for (const accountId of departed) {
      if (accountId === this.accountId) continue;
      await this.mutex.run(() => this.groups.removeMember(groupId, accountId)).catch(() => undefined);
    }
  }

  async removeGroupMember(conversationId: string, accountId: string): Promise<void> {
    const groupId = groupIdOf(conversationId)!;
    await this.mutex.run(() => this.groups.removeMember(groupId, accountId));
    this.emit('groups', groupId);
  }

  /** Sends the current group metadata so members (especially new ones) learn the name. */
  private async shareGroupMeta(record: GroupRecord): Promise<void> {
    await this.enqueue(record.groupId, { v: CONTENT_VERSION, kind: 'groupMeta',
      groupMeta: { name: record.name, version: record.metaVersion, ...(record.community ? { community: record.community } : {}) } }, false, undefined, [], true);
  }

  // --- communities (COM-01) ---------------------------------------------------------------

  /**
   * Creates a community: a new announcement channel (only admins post) registered as the
   * community root. Name and description stay E2EE in the channel's metadata.
   */
  async createCommunity(name: string, description: string): Promise<CommunityView> {
    if (description.length > 1000) throw new Error('description too long');
    const root = await this.createGroup(name, [], true);
    const rootGroupId = groupIdOf(root.id)!;
    const dto = await this.api.createCommunity(rootGroupId);
    await this.updateCommunityMeta(rootGroupId, (c) => ({ ...c, description: description.trim() }));
    return this.communityView(dto);
  }

  /** Communities this account belongs to (server references + E2EE names). */
  async communities(): Promise<CommunityView[]> {
    const mine = await this.api.myCommunities();
    return Promise.all(mine.map((dto) => this.communityView(dto)));
  }

  /**
   * Groups of a community as this account may see them. Labels come from the root's E2EE
   * metadata; a community admin who is in an active linked group publishes its missing label.
   */
  async communityGroups(community: CommunityView): Promise<CommunityGroup[]> {
    const links = await this.api.communityGroups(community.communityId);
    const root = await this.groups.record(community.rootGroupId);
    const labels = new Map((root?.community?.links ?? []).map((l) => [l.groupId, l.name]));
    const manager = community.role === 'owner' || community.role === 'admin';
    const missing: { groupId: string; name: string }[] = [];
    const out: CommunityGroup[] = [];
    for (const link of links) {
      const local = link.member ? await this.groups.record(link.groupId) : undefined;
      const name = (link.member ? local?.name : undefined) ?? (link.visibility === 'discoverable' ? labels.get(link.groupId) : undefined);
      // Only discoverable groups get a label in the root (seen by every member); never private ones.
      if (manager && link.status === 'active' && link.visibility === 'discoverable' && !labels.has(link.groupId) && local?.name) missing.push({ groupId: link.groupId, name: local.name });
      out.push({ ...link, conversationId: groupConversationId(link.groupId), name });
    }
    // Keep labels only for active links (an unlinked group's label disappears with it).
    const active = new Set(links.filter((l) => l.status === 'active' && l.visibility === 'discoverable').map((l) => l.groupId));
    const stale = [...labels.keys()].filter((id) => !active.has(id));
    if (manager && (missing.length || stale.length)) {
      await this.updateCommunityMeta(community.rootGroupId, (c) => ({
        ...c, links: [...c.links.filter((l) => active.has(l.groupId)), ...missing].slice(0, 50) })).catch(() => undefined);
    }
    return out;
  }

  /** Links a group this account belongs to; active at once if this account owns it. */
  async linkGroupToCommunity(community: CommunityView, conversationId: string, visibility: 'discoverable' | 'private', delegation = false): Promise<void> {
    const groupId = groupIdOf(conversationId);
    if (!groupId) throw new Error('not a group');
    await this.api.linkCommunityGroup(community.communityId, groupId, visibility, delegation);
    await this.communityGroups(community); // publishes the label when already active
  }

  /** The group owner accepts a link; `delegation` lets community removal also remove members here. */
  acceptCommunityLink(community: CommunityView, groupId: string, delegation = false): Promise<void> { return this.api.acceptCommunityLink(community.communityId, groupId, delegation); }

  /** Community admins: membership operations with display names (pending/blocked/completed). */
  async communityOperations(community: CommunityView): Promise<{ groupId: string; accountId: string; name: string; status: 'pending' | 'completed' | 'blocked' }[]> {
    const ops = await this.api.communityOperations(community.communityId);
    return Promise.all(ops.map(async (o) => ({ ...o, name: await this.displayName(o.accountId) })));
  }
  unlinkCommunityGroup(community: CommunityView, groupId: string): Promise<void> { return this.api.unlinkCommunityGroup(community.communityId, groupId); }
  /** Asks to join a discoverable group (its admins approve; nothing is shared before that). */
  requestCommunityGroup(community: CommunityView, groupId: string): Promise<void> { return this.api.requestCommunityGroup(community.communityId, groupId); }

  private async communityView(dto: CommunityDto): Promise<CommunityView> {
    const root = await this.groups.record(dto.rootGroupId);
    return { ...dto, conversationId: groupConversationId(dto.rootGroupId), name: root?.name || '', description: root?.community?.description ?? '' };
  }

  private async updateCommunityMeta(rootGroupId: string, change: (c: CommunityMeta) => CommunityMeta): Promise<void> {
    const record = await this.mutex.run(async () => {
      const current = await this.groups.record(rootGroupId);
      if (!current) throw new Error('community root unavailable');
      const next: GroupRecord = { ...current, metaVersion: current.metaVersion + 1, community: change(current.community ?? { description: '', links: [] }) };
      await this.repos.store.put('group', rootGroupId, next);
      return next;
    });
    await this.shareGroupMeta(record);
    this.emit('groups', rootGroupId);
  }

  /** Deletes a message on this device only. */
  async deleteLocally(target: ChatMessage): Promise<void> {
    await this.mutex.run(async () => {
      await this.repos.store.commit(this.repos.localDeletion(target));
      this.emit('messages', target.conversationId);
    });
  }

  /** Retries a failed/blocked outgoing message. */
  async retry(message: ChatMessage): Promise<void> {
    const item = await this.outbox.findByMessage(message.conversationId, message.id);
    if (!item) return;
    await this.repos.store.commit([this.repos.putMessage({ ...message, status: 'queued', error: undefined })]);
    this.emit('messages', message.conversationId);
    await this.outbox.retry(item.id);
  }

  /** Sends a transient typing indicator when the user enabled them. */
  async sendTyping(conversationId: string, action: 'started' | 'stopped'): Promise<void> {
    const conversation = this.conversationCache.get(conversationId);
    if (!this.currentSettings.typingIndicators || conversation?.kind !== 'direct' || conversation.request || this.socket.state !== 'online') return;
    const item = Outbox.create({
      destination: conversationId,
      content: { v: CONTENT_VERSION, kind: 'typing', typing: { action, timestamp: Date.now() } },
      selfAccountId: this.accountId,
      syncTranscript: false,
      transientTtlSeconds: TYPING_TTL_SECONDS,
    });
    await this.repos.store.commit([Outbox.op(item)]);
    void this.outbox.flush();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    if ('autoDownload' in patch) {
      const autoDownload = sanitizeAutoDownload(patch.autoDownload);
      if (!autoDownload) throw new Error('invalid auto-download settings');
      patch = { ...patch, autoDownload };
    }
    if ('saveToGallery' in patch && typeof patch.saveToGallery !== 'boolean') throw new Error('invalid gallery setting');
    if ('appLock' in patch && (typeof patch.appLock !== 'boolean' || (patch.appLock && this.passkeyEnrolled !== true && !this.currentSettings.appLock))) throw new Error('passkey required');
    if ('appLockAfterMinutes' in patch && ![0, 1, 5, 15].includes(patch.appLockAfterMinutes as number)) throw new Error('invalid app lock delay');
    if ('notificationPreview' in patch && !['generic', 'sender', 'full'].includes(patch.notificationPreview as string)) throw new Error('invalid preview');
    if ('notifications' in patch && typeof patch.notifications !== 'boolean') throw new Error('invalid notifications');
    if ('lockedChats' in patch && (!Array.isArray(patch.lockedChats) || patch.lockedChats.length > 1000 || !patch.lockedChats.every((id) => typeof id === 'string' && id.length <= 200))) throw new Error('invalid locked chats');
    this.currentSettings = { ...this.currentSettings, ...patch };
    await this.repos.store.commit([this.repos.putSettings(this.currentSettings)]);
    this.emit('settings', this.currentSettings);
  }

  lastSeenPrivacy() { return this.api.lastSeenPrivacy(); }
  /** Passkey/OTP registration at the IdP; network or IdP failures surface as `unavailable`. */
  async credentialStatus(): Promise<CredentialStatusDto> {
    let status: CredentialStatusDto;
    try { status = await this.api.accountCredentials(); } catch { status = { state: 'unavailable', passkey: false, otp: false }; }
    // An outage keeps the last confirmed answer, so lock options never flicker away.
    if (status.state === 'available' && status.passkey !== this.passkeyEnrolled) { this.passkeyEnrolled = status.passkey; this.emit('credentials', status.passkey); }
    return status;
  }

  /** Last confirmed passkey registration (`null` until the IdP answered once). */
  passkeyEnrolled: boolean | null = null;

  /** True when this chat requires passkey verification to open on this device. */
  isLocked(conversationId: string): boolean { return this.currentSettings.lockedChats.includes(conversationId); }

  /** Locks require a confirmed passkey; unlocking is always possible. */
  async setChatLocked(conversationId: string, locked: boolean): Promise<void> {
    if (locked && this.passkeyEnrolled !== true) throw new Error('passkey required');
    const others = this.currentSettings.lockedChats.filter((id) => id !== conversationId);
    await this.updateSettings({ lockedChats: locked ? [...others, conversationId] : others });
  }
  setLastSeenPrivacy(enabled: boolean) { return this.api.setLastSeenPrivacy(enabled); }
  lastSeenHeartbeat() { return this.api.lastSeenHeartbeat(); }
  lastSeen(accountId: string) { return this.api.lastSeen(accountId); }

  profiles(): Map<string, UserProfile> { return new Map(this.profileCache); }

  async updateProfile(patch: { photo?: string; status?: string }): Promise<void> {
    await this.mutex.run(async () => {
      // Merge against durable state while holding the same lock as history/mailbox processing.
      // A photo save must not replace a status saved concurrently or reloaded from the archive.
      const current = await this.repos.store.get<UserProfile>('profile', this.accountId);
      const profile: UserProfile = { accountId: this.accountId, status: '', ...current, ...patch,
        updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1) };
      if (!isProfile(profile)) throw new Error('invalid profile');
      const destinations = new Set([this.accountId]);
      for (const conversation of this.conversations()) {
        if (conversation.kind === 'group' && (conversation.left || (conversation.adminOnly && (await this.groups.record(groupIdOf(conversation.id)!))?.members.find((m) => m.accountId === this.accountId)?.role === 'member'))) continue;
        destinations.add(conversation.id);
      }
      const items = [...destinations].map((destination) => {
        const groupId = groupIdOf(destination);
        return Outbox.op(Outbox.create({ destination: groupId ?? destination, group: !!groupId,
          content: { v: CONTENT_VERSION, kind: 'profile', profile }, selfAccountId: this.accountId, syncTranscript: false }));
      });
      // Local changes and their outgoing broadcasts survive a crash together.
      await this.repos.store.commit([{ type: 'put', ns: 'profile', id: this.accountId, value: profile }, ...items]);
      this.profileCache.set(this.accountId, profile); this.emit('profiles', this.profiles());
    });
    void this.outbox.flush();
  }

  private stageProfile(profile: UserProfile, author: string, ops: StoreOp[]): void {
    if (profile.accountId !== author || (this.profileCache.get(author)?.updatedAt ?? 0) >= profile.updatedAt) return;
    this.profileCache.set(author, profile);
    ops.push({ type: 'put', ns: 'profile', id: author, value: profile });
  }

  recoveryStatus() { return this.api.recoveryStatus(); }
  async createRecoveryCode(): Promise<string> { await this.syncHistory(); return configureRecovery(this.api, this.signal, this.accountId, this.device.deploymentId); }

  /** Retry archival upload/download; usable on already linked browsers. */
  async syncHistory(): Promise<void> { await this.historySync?.sync(); }

  // --- devices ----------------------------------------------------------------------------

  devices() {
    return this.api.devices();
  }

  /** Pending requests from new devices that want to join this account. */
  async incomingLinkRequests(): Promise<IncomingLinkRequest[]> {
    const pending = await this.api.pendingProvisioning();
    return Promise.all(pending.map((p) => describeRequest(this.accountId, p)));
  }

  /** Approves a link request after the user compared the codes on both screens. */
  async approveLink(request: IncomingLinkRequest): Promise<void> {
    await approveRequest(this.api, this.signal, this.device, request, this.currentSettings.readReceipts);
    this.emit('devices', undefined);
  }

  /** Declines a link request. */
  async declineLink(provisioningId: string): Promise<void> {
    await this.api.declineProvisioning(provisioningId);
  }

  async unlinkDevice(deviceId: number): Promise<void> {
    await this.api.unlinkDevice(deviceId);
    this.emit('devices', undefined);
  }

  /** Unregisters this browser and wipes local data. */
  async signOutAndWipe(): Promise<void> {
    await this.syncHistory();
    if (this.historyStatus !== 'synced') throw new Error('history synchronization required before logout');
    const [devices, recovery] = await Promise.all([this.api.devices(), this.api.recoveryStatus()]);
    if (devices.length <= 1 && !recovery.configured) throw new LogoutRecoveryRequiredError();
    try {
      await this.api.unregisterSelf();
    } finally {
      this.stop();
      await this.repos.store.destroy();
    }
  }

  // --- envelope processing ----------------------------------------------------------------

  private async processEnvelope(envelope: EnvelopeDto): Promise<void> {
    if (await this.repos.store.isProcessed(envelope.guid)) {
      this.socket.ack([envelope.guid]);
      return;
    }
    const ops: StoreOp[] = [{ type: 'processed', guid: envelope.guid }];
    const changed = new Set<string>();
    let followUps: (() => Promise<void>)[] = [];
    if (envelope.type.startsWith('MLS_')) {
      try {
        followUps = await this.processGroupEnvelope(envelope, ops, changed);
      } catch (error) {
        console.warn('Group envelope processing failed', error instanceof Error ? error.message : 'error');
      }
      await this.repos.store.commit(ops);
      this.socket.ack([envelope.guid]);
      changed.forEach((id) => this.emit('messages', id));
      this.emitConversations();
      this.emit('profiles', this.profiles());
      for (const task of followUps) await task();
      return;
    }
    try {
      const { plaintext, ops: protocolOps } = await this.sessions.decrypt(envelope);
      ops.push(...protocolOps);
      const content = decodeContent(plaintext);
      followUps = await this.applyContent(envelope, content, ops, changed);
    } catch (error) {
      if (error instanceof UntrustedIdentityError) {
        await this.flagIdentityChange(error.accountId, ops);
      } else {
        console.warn('Envelope processing failed', error instanceof Error ? error.name : 'error');
        await this.recordUndecryptable(envelope, ops, changed);
      }
    }
    await this.repos.store.commit(ops);
    this.socket.ack([envelope.guid]);
    changed.forEach((id) => this.emit('messages', id));
    this.emitConversations();
    this.emit('profiles', this.profiles());
    for (const task of followUps) await task();
  }

  /**
   * Applies decrypted content, appending store ops. Returns follow-up actions (receipts) that
   * must run only after the commit.
   */
  private async applyContent(envelope: EnvelopeDto, content: ReturnType<typeof decodeContent>, ops: StoreOp[], changed: Set<string>) {
    const sender = envelope.sourceAccount!;
    const fromSelf = sender === this.accountId;
    const followUps: (() => Promise<void>)[] = [];

    if (content.kind === 'unknown') {
      const conversation = await this.ensureConversation(fromSelf ? this.accountId : sender, ops);
      const message: ChatMessage = {
        conversationId: conversation.id,
        id: envelope.guid,
        authorId: sender,
        direction: fromSelf ? 'out' : 'in',
        sentAt: envelope.serverTimestamp,
        sort: envelope.serverTimestamp,
        reactions: {},
        unsupported: true,
      };
      ops.push(this.repos.putMessage(message));
      changed.add(conversation.id);
      return followUps;
    }

    // Blocked contacts: drop all direct content (nothing is stored, no receipts are sent).
    if (!fromSelf && this.isBlocked(sender)) return followUps;
    switch (content.kind) {
      case 'profile':
        this.stageProfile(content.profile, sender, ops);
        return followUps;
      case 'data': {
        if (fromSelf) return followUps; // own devices exchange data via sync transcripts
        const result = await this.applyData(sender, sender, 'in', content.data, envelope, ops, changed);
        followUps.push(...this.receiptFollowUps(result, sender, sender, content.data));
        if (result === 'new') {
          const ownProfile = this.profileCache.get(this.accountId);
          if (ownProfile && !content.data.profile && !this.conversationCache.get(sender)?.request) followUps.push(() => this.enqueue(sender, { v: CONTENT_VERSION, kind: 'profile', profile: ownProfile }, false));
        }
        return followUps;
      }
      case 'sync': {
        if (!fromSelf) return followUps; // only own devices may send sync content
        if (content.sync.sent) {
          const { destination, data } = content.sync.sent;
          await this.applyData(destination, this.accountId, 'out', data, envelope, ops, changed);
        }
        if (content.sync.onboarding) await this.applyOnboardingSync(content.sync.onboarding, ops);
        if (content.sync.read) {
          const c = this.conversationCache.get(content.sync.read.conversationId);
          if (c && (c.unread > 0 || c.revisedUnread?.length)) this.stage(ops, { ...c, unread: 0, revisedUnread: undefined, mentioned: undefined });
        }
        return followUps;
      }
      case 'receipt': {
        const conversationId = content.receipt.conversationId ?? sender;
        if (content.receipt.conversationId && !groupIdOf(conversationId)) return followUps;
        for (const [index, id] of content.receipt.messageIds.entries()) {
          const target = await this.repos.message(conversationId, this.accountId, id);
          if (!target || target.direction !== 'out' || target.deleted) continue;
          // Receipts for an older revision cannot mark edited content as delivered or read.
          if ((content.receipt.revisions?.[index] ?? 0) < (target.revision ?? 0)) continue;
          const recipients = target.recipientAccountIds ?? (groupIdOf(conversationId) ? [] : [sender]);
          if (!recipients.includes(sender)) continue;
          const receivedAt = envelope.serverTimestamp;
          const prior = target.receipts?.[sender] ?? {};
          const receiptState = { deliveredAt: prior.deliveredAt ?? receivedAt,
            readAt: content.receipt.type === 'read' ? prior.readAt ?? receivedAt : prior.readAt };
          const receipts = { ...target.receipts, [sender]: receiptState };
          const rank = recipients.every((account) => receipts[account]?.readAt) ? 'read'
            : recipients.every((account) => receipts[account]?.deliveredAt) ? 'delivered' : 'sent';
          ops.push(this.repos.putMessage({ ...target, receipts, status: STATUS_RANK[rank] > STATUS_RANK[target.status ?? 'sent'] ? rank : target.status }));
          changed.add(conversationId);
        }
        return followUps;
      }
      case 'typing': {
        if (!fromSelf && this.currentSettings.typingIndicators) {
          const until = content.typing.action === 'started' ? Date.now() + TYPING_TTL_SECONDS * 1000 : 0;
          followUps.push(async () => this.emit('typing', { conversationId: sender, until }));
        }
        return followUps;
      }
      case 'groupMeta':
        return followUps; // only meaningful inside a group
      case 'call':
        return this.applyCall(content.call, sender, undefined, envelope, ops);
      case 'ack':
        await this.applyAck(sender, content.ack, envelope, ops, changed);
        return followUps;
      case 'rulesAck':
        await this.applyRulesAck(sender, content.rulesAck, envelope, ops);
        return followUps;
    }
  }

  /**
   * An acknowledgement (specs §30.6). Reviewers record it only from audience members for the
   * current request revision; own devices learn that this account already responded.
   */
  private async applyAck(sender: string, ack: AckResponse, envelope: EnvelopeDto, ops: StoreOp[], changed: Set<string>): Promise<void> {
    const target = await this.repos.message(ack.conversationId, ack.authorId, ack.messageId);
    const request = target?.ackRequest;
    if (!target || !request || target.deleted || request.requestId !== ack.requestId || request.revision !== ack.requestRevision) return;
    if (sender === this.accountId) {
      if ((target.myAck?.revision ?? -1) >= ack.contentRevision) return;
      ops.push(this.repos.putMessage({ ...target, myAck: { revision: ack.contentRevision, at: ack.timestamp, pending: [] } }));
    } else {
      if (!request.reviewers.includes(this.accountId) || !request.audience.includes(sender)) return;
      if ((target.acks?.[sender]?.revision ?? -1) >= ack.contentRevision) return; // dedupe across devices/retries
      ops.push(this.repos.putMessage({ ...target, acks: { ...target.acks, [sender]: { at: envelope.serverTimestamp, revision: ack.contentRevision } } }));
    }
    changed.add(ack.conversationId);
  }

  /**
   * Explicitly acknowledges an announcement: one pairwise response per named reviewer plus an
   * own-device sync. Delivery, opening or read receipts never do this on the user's behalf.
   */
  async acknowledge(message: ChatMessage): Promise<void> {
    const request = message.ackRequest;
    if (!request || !request.audience.includes(this.accountId) || message.deleted) throw new Error('nothing to acknowledge');
    const revision = message.revision ?? 0;
    if (message.myAck?.revision === revision) return;
    const ack: AckResponse = { requestId: request.requestId, requestRevision: request.revision, conversationId: message.conversationId,
      messageId: message.id, authorId: message.authorId, contentRevision: revision, timestamp: Date.now() };
    const reviewers = request.reviewers.filter((id) => id !== this.accountId);
    await this.mutex.run(async () => {
      const current = await this.repos.message(message.conversationId, message.authorId, message.id) ?? message;
      const ops: StoreOp[] = [this.repos.putMessage({ ...current, myAck: { revision, at: ack.timestamp, pending: reviewers } })];
      // A reviewer who is also in the audience records their own response directly.
      if (request.reviewers.includes(this.accountId)) {
        ops[0] = this.repos.putMessage({ ...current, myAck: { revision, at: ack.timestamp, pending: reviewers }, acks: { ...current.acks, [this.accountId]: { at: ack.timestamp, revision } } });
      }
      await this.repos.store.commit(ops);
      for (const reviewer of reviewers) await this.enqueue(reviewer, { v: CONTENT_VERSION, kind: 'ack', ack }, false);
      await this.enqueue(this.accountId, { v: CONTENT_VERSION, kind: 'ack', ack }, false);
    });
    this.emit('messages', message.conversationId);
  }

  /**
   * Request for an announcement in a community root this account manages: reviewers are the
   * publisher and the community owner(s); the audience is everyone else in the community now.
   */
  private newAckRequest(group: GroupRecord, recipients: string[]): AckRequest {
    const role = group.members.find((m) => m.accountId === this.accountId)?.role;
    if (!group.community || !group.adminOnly || (role !== 'owner' && role !== 'admin')) throw new Error('acknowledgements are for community announcements');
    const owners = group.members.filter((m) => m.role === 'owner').map((m) => m.accountId);
    return { requestId: newMessageId(), revision: 1, reviewers: [...new Set([this.accountId, ...owners])].slice(0, 10), audience: recipients.slice(0, 5000) };
  }

  /** Accept a request only in a community root, from an owner/admin, naming owners/admins as reviewers. */
  private async validAckRequest(conversationId: string, authorId: string, request: AckRequest): Promise<boolean> {
    const groupId = groupIdOf(conversationId);
    const group = groupId ? await this.groups.record(groupId) : undefined;
    if (!group?.adminOnly || !group.community) return false;
    const manager = (id: string) => ['owner', 'admin'].includes(group.members.find((m) => m.accountId === id)?.role ?? '');
    return manager(authorId) && request.reviewers.every(manager) && !request.audience.includes(authorId);
  }

  // --- community onboarding (specs §30.7) -------------------------------------------------

  /**
   * Publishes the onboarding package (root owners/admins). The rules version advances only when
   * the rules text changes, so welcome/recommendation edits keep existing acknowledgements valid.
   */
  async saveOnboarding(community: CommunityView, draft: { welcome: string; rules: string; ackRequired: boolean; recommended: string[];
    checklist: { id: string; label: string; required: boolean }[]; contact?: string }): Promise<void> {
    const root = await this.groups.record(community.rootGroupId);
    const role = root?.members.find((m) => m.accountId === this.accountId)?.role;
    if (!root || (role !== 'owner' && role !== 'admin')) throw new Error('only community admins edit onboarding');
    const previous = root.community?.onboarding;
    const text = draft.rules.trim();
    const digest = text ? toBase64Url(await sha256(utf8(text))) : undefined;
    const owners = root.members.filter((m) => m.role === 'owner').map((m) => m.accountId);
    const rules = text && digest ? {
      version: previous?.rules?.digest === digest ? previous.rules.version : (previous?.rules?.version ?? 0) + 1,
      text, digest, ackRequired: draft.ackRequired, reviewers: [...new Set([this.accountId, ...owners])].slice(0, 10) } : undefined;
    const onboarding: OnboardingPackage = { revision: (previous?.revision ?? 0) + 1, editor: this.accountId, welcome: draft.welcome.trim().slice(0, 4000),
      ...(rules ? { rules } : {}), recommended: draft.recommended.slice(0, 20), checklist: draft.checklist.slice(0, 20), ...(draft.contact?.trim() ? { contact: draft.contact.trim().slice(0, 200) } : {}) };
    await this.updateCommunityMeta(community.rootGroupId, (c) => ({ ...c, onboarding }));
  }

  /** Onboarding package (validated), this account's private progress, and reviewer counts. */
  async onboarding(community: CommunityView): Promise<OnboardingView | undefined> {
    const root = await this.groups.record(community.rootGroupId);
    const pkg = root?.community?.onboarding;
    if (!root || !pkg) return undefined;
    const editorRole = root.members.find((m) => m.accountId === pkg.editor)?.role;
    if (editorRole !== 'owner' && editorRole !== 'admin') return undefined; // not from a current editor
    const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, community.rootGroupId) ?? { items: {} };
    const reviewer = !!pkg.rules?.reviewers.includes(this.accountId);
    const acks = reviewer ? await this.repos.store.get<{ version: number; accounts: Record<string, number> }>(RecordNs.rulesAcks, community.rootGroupId) : undefined;
    const audience = root.members.map((m) => m.accountId).filter((id) => id !== this.accountId && !pkg.rules?.reviewers.includes(id));
    return { pkg, progress, reviewer,
      rulesAcknowledged: reviewer && acks?.version === pkg.rules?.version ? Object.keys(acks!.accounts).filter((id) => audience.includes(id)) : [],
      audience };
  }

  /** Ticks/unticks a private checklist item; synced to own devices only. */
  async setChecklistItem(community: CommunityView, itemId: string, done: boolean): Promise<void> {
    const update = await this.mutex.run(async () => {
      const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, community.rootGroupId) ?? { items: {} };
      const counter = (progress.items[itemId]?.counter ?? 0) + 1;
      await this.repos.store.put(RecordNs.onboarding, community.rootGroupId, { ...progress, items: { ...progress.items, [itemId]: { done, counter } } });
      return { conversationId: community.conversationId, itemId, done, counter };
    });
    await this.enqueue(this.accountId, { v: CONTENT_VERSION, kind: 'sync', sync: { onboarding: update } }, false);
    this.emit('groups', community.rootGroupId);
  }

  /** Explicitly acknowledges the current rules version (only the named reviewers receive it). */
  async acknowledgeRules(community: CommunityView): Promise<void> {
    const view = await this.onboarding(community);
    const rules = view?.pkg.rules;
    if (!rules?.ackRequired) throw new Error('no rules to acknowledge');
    const rulesAck: RulesAck = { conversationId: community.conversationId, version: rules.version, digest: rules.digest, timestamp: Date.now() };
    const reviewers = rules.reviewers.filter((id) => id !== this.accountId);
    await this.mutex.run(async () => {
      const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, community.rootGroupId) ?? { items: {} };
      await this.repos.store.put(RecordNs.onboarding, community.rootGroupId, { ...progress, rulesAck: { version: rules.version, pending: reviewers } });
      for (const reviewer of reviewers) await this.enqueue(reviewer, { v: CONTENT_VERSION, kind: 'rulesAck', rulesAck }, false);
      await this.enqueue(this.accountId, { v: CONTENT_VERSION, kind: 'rulesAck', rulesAck }, false);
    });
    this.emit('groups', community.rootGroupId);
  }

  private async applyOnboardingSync(update: { conversationId: string; itemId: string; done: boolean; counter: number }, ops: StoreOp[]): Promise<void> {
    const rootGroupId = groupIdOf(update.conversationId);
    if (!rootGroupId) return;
    const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, rootGroupId) ?? { items: {} };
    if ((progress.items[update.itemId]?.counter ?? 0) >= update.counter) return; // older or duplicate mutation
    ops.push({ type: 'put', ns: RecordNs.onboarding, id: rootGroupId, value: { ...progress, items: { ...progress.items, [update.itemId]: { done: update.done, counter: update.counter } } } });
    this.emit('groups', rootGroupId);
  }

  /** Reviewers keep responses for the current rules version only (bounded retention). */
  private async applyRulesAck(sender: string, ack: RulesAck, envelope: EnvelopeDto, ops: StoreOp[]): Promise<void> {
    const rootGroupId = groupIdOf(ack.conversationId);
    const root = rootGroupId ? await this.groups.record(rootGroupId) : undefined;
    const rules = root?.community?.onboarding?.rules;
    if (!rootGroupId || !root || !rules || rules.version !== ack.version || rules.digest !== ack.digest) return;
    if (sender === this.accountId) {
      const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, rootGroupId) ?? { items: {} };
      if ((progress.rulesAck?.version ?? 0) >= ack.version && !progress.rulesAck?.pending.length) return;
      ops.push({ type: 'put', ns: RecordNs.onboarding, id: rootGroupId, value: { ...progress, rulesAck: { version: ack.version, pending: [] } } });
    } else {
      if (!rules.reviewers.includes(this.accountId) || !root.members.some((m) => m.accountId === sender)) return;
      const current = await this.repos.store.get<{ version: number; accounts: Record<string, number> }>(RecordNs.rulesAcks, rootGroupId);
      const accounts = current?.version === ack.version ? current.accounts : {};
      if (accounts[sender]) return;
      ops.push({ type: 'put', ns: RecordNs.rulesAcks, id: rootGroupId, value: { version: ack.version, accounts: { ...accounts, [sender]: envelope.serverTimestamp } } });
    }
    this.emit('groups', rootGroupId);
  }

  /** Clears a reviewer from the pending list once their response was accepted by the server. */
  private async ackDelivered(item: OutboxItem): Promise<void> {
    if (item.content.kind === 'rulesAck' && item.destination !== this.accountId) {
      // Runs inside the outbox's exclusive section (the client mutex, not re-entrant): no mutex here.
      const rootGroupId = groupIdOf(item.content.rulesAck.conversationId)!;
      const progress = await this.repos.store.get<OnboardingProgress>(RecordNs.onboarding, rootGroupId);
      if (progress?.rulesAck?.pending.includes(item.destination)) {
        await this.repos.store.put(RecordNs.onboarding, rootGroupId, { ...progress, rulesAck: { ...progress.rulesAck, pending: progress.rulesAck.pending.filter((id) => id !== item.destination) } });
        this.emit('groups', rootGroupId);
      }
      return;
    }
    if (item.content.kind !== 'ack' || item.destination === this.accountId) return;
    const ack = item.content.ack;
    const target = await this.repos.message(ack.conversationId, ack.authorId, ack.messageId);
    if (!target?.myAck || target.myAck.revision !== ack.contentRevision || !target.myAck.pending.includes(item.destination)) return;
    await this.repos.store.commit([this.repos.putMessage({ ...target, myAck: { ...target.myAck, pending: target.myAck.pending.filter((id) => id !== item.destination) } })]);
    this.emit('messages', ack.conversationId);
  }

  /** MLS envelopes: Welcome (join), commit (membership change), application message. */
  private async processGroupEnvelope(envelope: EnvelopeDto, ops: StoreOp[], changed: Set<string>): Promise<(() => Promise<void>)[]> {
    const result = await this.groups.process(envelope);
    if (!result) return [];
    ops.push(...result.ops);
    const conversationId = groupConversationId(result.groupId);
    const followUps: (() => Promise<void>)[] = [];
    if (result.joined) {
      const existing = this.conversationCache.get(conversationId);
      this.stage(ops, existing ? { ...existing, left: false } : this.newGroupConversation(result.groupId, ''));
      followUps.push(() => this.refreshGroup(result.groupId));
    }
    if (result.removed) {
      const existing = this.conversationCache.get(conversationId);
      if (existing) this.stage(ops, { ...existing, left: true });
    }
    if (result.changed) followUps.push(() => this.refreshGroup(result.groupId));
    if (result.application) {
      const { accountId } = result.application;
      const content = decodeContent(result.application.plaintext);
      const conversation = this.conversationCache.get(conversationId) ?? this.newGroupConversation(result.groupId, '');
      if (!this.conversationCache.has(conversationId)) this.stage(ops, conversation);
      const direction = accountId === this.accountId ? 'out' : 'in';
      if (content.kind === 'data') {
        const applied = await this.applyData(conversationId, accountId, direction, content.data, envelope, ops, changed);
        if (accountId !== this.accountId) followUps.push(...this.receiptFollowUps(applied, accountId, conversationId, content.data));
        if (applied === 'left') followUps.push(() => this.refreshGroup(result.groupId));
      } else if (content.kind === 'profile') {
        this.stageProfile(content.profile, accountId, ops);
      } else if (content.kind === 'groupMeta') {
        await this.applyGroupMeta(result.groupId, content.groupMeta, ops, accountId);
      } else if (content.kind === 'call') {
        followUps.push(...await this.applyCall(content.call, accountId, conversationId, envelope, ops));
      } else if (content.kind === 'unknown') {
        ops.push(this.repos.putMessage({
          conversationId, id: envelope.guid, authorId: accountId, direction, sentAt: envelope.serverTimestamp,
          sort: envelope.serverTimestamp, reactions: {}, unsupported: true,
        }));
        changed.add(conversationId);
      }
    }
    return followUps;
  }

  /** Applies a newer encrypted group name (highest version wins). */
  private async applyGroupMeta(groupId: string, meta: GroupMeta, ops: StoreOp[], author?: string): Promise<void> {
    const record = await this.groups.record(groupId);
    if (!record || meta.version <= record.metaVersion) return;
    // Community metadata (descriptions, linked-group labels) only from the root's owners/admins.
    const role = record.members.find((m) => m.accountId === author)?.role;
    const community = meta.community && (role === 'owner' || role === 'admin') ? meta.community : record.community;
    ops.push({ type: 'put', ns: 'group', id: groupId, value: { ...record, name: meta.name, metaVersion: meta.version, ...(community ? { community } : {}) } });
    const conversation = this.conversationCache.get(groupConversationId(groupId));
    if (conversation) this.stage(ops, { ...conversation, title: meta.name });
  }

  /** Reloads roles/members from the server ACL mirror after joins and commits. */
  private async refreshGroup(groupId: string): Promise<void> {
    const record = await this.groups.refreshRecord(groupId).catch(() => undefined);
    if (record && !record.left && record.departed?.length) {
      // Small jitter so several online members do not all race the same removal commit.
      const departed = record.departed;
      setTimeout(() => void this.completeDepartures(groupId, departed).then(() => this.refreshGroup(groupId)), 200 + Math.random() * 1500);
    }
    const conversation = this.conversationCache.get(groupConversationId(groupId));
    if (record && conversation) {
      await this.saveConversations([{ ...conversation, title: record.name || conversation.title, left: record.left, adminOnly: record.adminOnly }]);
    }
    this.emit('groups', groupId);
  }

  private newGroupConversation(groupId: string, name: string): Conversation {
    return { ...this.newConversation(groupConversationId(groupId), name || 'Group'), kind: 'group' };
  }

  /**
   * Applies a data message authored by `authorId` into conversation `conversationId`.
   *
   * @returns 'new' when a new visible message was stored
   */
  private async applyData(
    conversationId: string,
    authorId: string,
    direction: 'in' | 'out',
    data: DataMessage,
    envelope: EnvelopeDto,
    ops: StoreOp[],
    changed: Set<string>,
  ): Promise<'new' | 'edited' | 'mutation' | 'ignored' | 'left'> {
    if (data.profile) this.stageProfile(data.profile, authorId, ops);
    const targetId = data.reaction?.targetMessageId ?? data.edit?.targetMessageId ?? data.delete?.targetMessageId ?? data.messageId;
    const targetAuthor = data.reaction?.targetAuthorId ?? authorId;
    if (await this.repos.isLocallyDeleted({ conversationId, authorId: targetAuthor, id: targetId })) return 'ignored';
    const isNewChat = !this.conversationCache.has(conversationId);
    const conversation = await this.ensureConversation(conversationId, ops);
    changed.add(conversation.id);

    if (data.reaction) {
      const r = data.reaction;
      const target = await this.repos.message(conversation.id, r.targetAuthorId, r.targetMessageId);
      if (!target || target.deleted) return 'ignored';
      ops.push(this.repos.putMessage(applyReaction(target, authorId, r.emoji, r.remove)));
      return 'mutation';
    }
    if (data.edit) {
      // Only the original author may edit (looked up by author), inside the server-time window,
      // with a newer revision. Edits never notify or change unread counts (specs §25.1).
      const target = await this.repos.message(conversation.id, authorId, data.edit.targetMessageId);
      if (!target) return 'ignored';
      const body = acceptsEdit(target, conversation, data.edit.body, data.edit.revision, data.timestamp, envelope.serverTimestamp);
      if (body === undefined) return 'ignored';
      ops.push(this.repos.putMessage(direction === 'out' ? revised(target, body, data.timestamp, data.edit.revision)
        : { ...target, body, editedAt: data.timestamp, revision: data.edit.revision }));
      const visible = this.activeConversation === conversation.id && document.visibilityState === 'visible';
      let updated = await this.withEditedPreview(conversation, target, body);
      if (direction === 'in' && !visible && conversation.kind !== 'note') {
        const pending = (conversation.revisedUnread ?? []).filter((r) => r.authorId !== authorId || r.id !== target.id);
        updated = { ...updated, revisedUnread: [...pending, { authorId, id: target.id }].slice(-MAX_REVISED_UNREAD) };
      }
      if (updated !== conversation) this.stage(ops, updated);
      return 'edited';
    }
    if (data.delete) {
      const target = await this.repos.message(conversation.id, authorId, data.delete.targetMessageId);
      if (!target) return 'ignored';
      ops.push(this.repos.putMessage(tombstone(target)));
      return 'mutation';
    }
    if (data.timerUpdate) return this.applyTimerUpdate(conversation, authorId, direction, data, envelope, ops);
    if (data.pin) return this.applyPin(conversation, authorId, data, ops);
    if (data.left) {
      if (!groupIdOf(conversation.id) || await this.repos.message(conversation.id, authorId, data.messageId)) return 'ignored';
      ops.push(this.repos.putMessage({ conversationId: conversation.id, id: data.messageId, authorId, direction, sentAt: data.timestamp,
        sort: direction === 'out' ? data.timestamp : envelope.serverTimestamp, reactions: {}, notice: { kind: 'left' } }));
      return 'left';
    }
    if (data.body === undefined && !data.attachments?.length) return 'ignored';
    if (await this.repos.message(conversation.id, authorId, data.messageId)) return 'ignored'; // semantic dedupe
    ops.push({ type: 'delete', ns: RecordNs.localHiddenConversation, id: conversationId });

    const message: ChatMessage = {
      conversationId: conversation.id,
      id: data.messageId,
      recipientAccountIds: data.recipientAccountIds,
      authorId,
      direction,
      body: data.body,
      attachments: data.attachments,
      forwarded: data.forwarded === true || undefined,
      quote: data.quote,
      sentAt: data.timestamp,
      serverAt: envelope.serverTimestamp,
      sort: direction === 'out' ? data.timestamp : envelope.serverTimestamp,
      status: direction === 'out' ? 'sent' : undefined,
      reactions: {},
      expireTimer: data.expireTimer || undefined,
      mentions: groupIdOf(conversation.id) && data.mentions?.length ? data.mentions : undefined,
      ackRequest: data.ackRequest && await this.validAckRequest(conversation.id, authorId, data.ackRequest) ? data.ackRequest : undefined,
    };
    const visible = this.activeConversation === conversation.id && document.visibilityState === 'visible';
    const mentionsMe = direction === 'in' && !visible && !!message.mentions?.includes(this.accountId);
    // Own messages count down from sending; received ones from being read on this device.
    const timed = direction === 'out' ? (message.expireTimer ? { ...message, expiresAt: data.timestamp + message.expireTimer * 1000 } : message)
      : visible ? startExpiry(message, Date.now()) : message;
    ops.push(this.repos.putMessage(timed));
    const expiry = expiryOp(timed); if (expiry) ops.push(expiry);
    this.stage(ops, {
      ...conversation,
      lastActivity: Math.max(conversation.lastActivity, message.sort),
      preview: previewOf(data),
      previewFromMe: direction === 'out',
      previewAuthor: authorId,
      archived: conversation.archived && conversation.muted,
      unread: direction === 'in' && !visible ? conversation.unread + 1 : conversation.unread,
      mentioned: conversation.mentioned || mentionsMe || undefined,
      // First contact from someone new is a message request (direct chats only).
      request: conversation.request || (isNewChat && direction === 'in' && conversation.kind === 'direct') || undefined,
    });
    return 'new';
  }

  private async recordUndecryptable(envelope: EnvelopeDto, ops: StoreOp[], changed: Set<string>): Promise<void> {
    if (!envelope.sourceAccount) return;
    const conversation = await this.ensureConversation(envelope.sourceAccount === this.accountId ? this.accountId : envelope.sourceAccount, ops);
    ops.push(this.repos.putMessage({
      conversationId: conversation.id,
      id: envelope.guid,
      authorId: envelope.sourceAccount,
      direction: envelope.sourceAccount === this.accountId ? 'out' : 'in',
      sentAt: envelope.serverTimestamp,
      sort: envelope.serverTimestamp,
      reactions: {},
      undecryptable: true,
    }));
    changed.add(conversation.id);
  }

  private async flagIdentityChange(peerId: string, ops: StoreOp[]): Promise<void> {
    const conversation = await this.ensureConversation(peerId, ops);
    this.stage(ops, { ...conversation, identityChangedAt: Date.now() });
  }

  private async ensureConversation(id: string, ops: StoreOp[]): Promise<Conversation> {
    const existing = this.conversationCache.get(id);
    if (existing) return existing;
    const account = id === this.accountId ? undefined : await this.lookupAccount(id);
    const title = id === this.accountId ? labelOf(this.device) : account ? labelOf(account) : 'Unknown';
    const conversation = this.newConversation(id, title);
    this.stage(ops, conversation);
    return conversation;
  }

  private newConversation(id: string, title: string): Conversation {
    return {
      id,
      kind: id === this.accountId ? 'note' : 'direct',
      title,
      lastActivity: Date.now(),
      unread: 0,
      pinned: false,
      muted: false,
      archived: false,
    };
  }

  private lookupAccount(accountId: string): Promise<AccountDto | undefined> {
    let lookup = this.accountCache.get(accountId);
    if (!lookup) {
      lookup = this.api.account(accountId).catch(() => undefined);
      this.accountCache.set(accountId, lookup);
    }
    return lookup;
  }

  // --- outbox integration -----------------------------------------------------------------

  /**
   * Queues content for a conversation or account. Group conversations (`g:<id>`) become one MLS
   * application message; direct destinations use Signal fan-out (+ own-device transcript).
   */
  private async enqueue(
    destination: string,
    content: Content,
    syncTranscript: boolean,
    message?: { conversationId: string; id: string },
    extraOps: StoreOp[] = [],
    group = false,
    urgent = false,
  ): Promise<void> {
    const groupId = group ? destination : groupIdOf(destination);
    const item = groupId
      ? Outbox.create({ destination: groupId, content, selfAccountId: this.accountId, syncTranscript: false, message, group: true, urgent })
      : Outbox.create({ destination, content, selfAccountId: this.accountId, syncTranscript, message, urgent });
    await this.repos.store.commit([...extraOps, Outbox.op(item)]);
    void this.outbox.flush();
  }

  /** Outbox callback. Runs inside the outbox's exclusive section, i.e. the client mutex: never call `mutex.run` from here. */
  private async onOutboxAccepted(item: OutboxItem): Promise<void> {
    if (item.content.kind === 'ack' || item.content.kind === 'rulesAck') { await this.ackDelivered(item); return; }
    await this.updateStatus(item, 'sent');
  }

  private async onOutboxFailed(item: OutboxItem, reason: 'failed' | 'blocked', error: unknown): Promise<void> {
    if (reason === 'blocked') {
      const c = this.conversationCache.get(item.destination);
      if (c) await this.saveConversations([{ ...c, identityChangedAt: Date.now() }]);
    }
    await this.updateStatus(item, reason, error instanceof ApiError ? error.code : undefined);
  }

  private async updateStatus(item: OutboxItem, status: MessageStatus, error?: string): Promise<void> {
    if (!item.message) return;
    const current = await this.repos.message(item.message.conversationId, this.accountId, item.message.id);
    if (!current) return;
    if (status === 'sent' && STATUS_RANK[current.status ?? 'queued'] >= STATUS_RANK.sent) return;
    await this.repos.store.commit([this.repos.putMessage({ ...current, status, error })]);
    this.emit('messages', item.message.conversationId);
  }

  private async blockedItems(destination: string): Promise<OutboxItem[]> {
    return (await this.repos.store.list<OutboxItem>('outbox')).filter((i) => i.destination === destination && i.state === 'blocked');
  }

  // --- directives -------------------------------------------------------------------------

  private async onDirective(directive: Directive): Promise<void> {
    switch (directive) {
      case 'KEYS_LOW': {
        const next = await this.mutex.run(() => replenishPreKeys(this.api, this.signal, this.device.nextPreKeyId));
        this.device.nextPreKeyId = next;
        await this.repos.store.commit([this.repos.putDeviceState(this.device)]);
        break;
      }
      case 'KEYPACKAGES_LOW':
        await this.mutex.run(() => this.groups.ensureKeyPackages()).catch(() => undefined);
        break;
      case 'GROUPS_CHANGED':
        await this.refreshAllGroups();
        break;
      case 'DEVICE_LIST_CHANGED':
        this.emit('devices', undefined);
        await this.checkDeviceChanges().catch(() => undefined);
        await this.syncOwnDevicesInGroups().catch(() => undefined);
        break;
      case 'REVOKED':
        await this.handleRevoked();
        break;
      case 'POLICY_UPDATED':
        break;
    }
  }

  private async handleRevoked(): Promise<void> {
    this.stop();
    await this.repos.store.destroy();
    this.emit('revoked', undefined);
  }

  // --- helpers ----------------------------------------------------------------------------

  /** The chat-list preview follows an edit of the conversation's latest message. */
  private async withEditedPreview(conversation: Conversation, target: ChatMessage, body: string): Promise<Conversation> {
    const [latest] = await this.repos.messages(conversation.id, 1);
    const isLatest = latest?.id === target.id && latest.authorId === target.authorId;
    return isLatest && conversation.preview !== body ? { ...conversation, preview: body } : conversation;
  }

  /**
   * Delivery (and, when the chat is on screen, read) receipts after a new message or an accepted
   * edit. Edits acknowledge the new revision; nothing is sent for other mutations.
   */
  private receiptFollowUps(result: 'new' | 'edited' | 'mutation' | 'ignored' | 'left', author: string, conversationId: string, data: DataMessage): (() => Promise<void>)[] {
    if (result !== 'new' && result !== 'edited') return [];
    const id = result === 'edited' ? data.edit!.targetMessageId : data.messageId;
    const revisions = result === 'edited' ? [data.edit!.revision ?? 0] : undefined;
    const group = groupIdOf(conversationId) ? conversationId : undefined;
    const followUps = [() => this.enqueue(author, receipt('delivery', [id], group, revisions), false)];
    if (result === 'new') followUps.push(async () => this.emitAlert(conversationId, author, data));
    if (this.currentSettings.readReceipts && !this.conversationCache.get(conversationId)?.request && this.activeConversation === conversationId && document.visibilityState === 'visible') {
      followUps.push(() => this.enqueue(author, receipt('read', [id], group, revisions), false));
    }
    return followUps;
  }

  /** Stages a conversation update into a batch and the in-memory cache. */
  private stage(ops: StoreOp[], conversation: Conversation): void {
    this.conversationCache.set(conversation.id, conversation);
    ops.push(this.repos.putConversation(conversation));
  }

  private async saveConversations(conversations: Conversation[]): Promise<void> {
    await this.repos.store.commit(conversations.map((c) => this.repos.putConversation(c)));
    conversations.forEach((c) => this.conversationCache.set(c.id, c));
    this.emitConversations();
  }

  private emitConversations(): void {
    this.emit('conversations', this.conversations());
  }
}

/** Local conversation-list preview of a message. */
function previewOf(data: DataMessage): string {
  if (data.body) return data.body;
  const first = data.attachments?.[0];
  if (!first) return '';
  if (first.voiceNote) return '🎤 Voice message';
  return first.contentType.startsWith('image/') ? '📷 Photo' : `📎 ${first.fileName ?? 'File'}`;
}

function receipt(type: 'delivery' | 'read', messageIds: string[], conversationId?: string, revisions?: number[]): Content {
  return { v: CONTENT_VERSION, kind: 'receipt', receipt: { type, messageIds, conversationId, timestamp: Date.now(),
    ...(revisions?.some((r) => r > 0) ? { revisions } : {}) } };
}

/** Pending re-read acknowledgements kept per conversation (oldest dropped first). */
const MAX_REVISED_UNREAD = 200;

/** A new own revision: receipts of earlier revisions no longer describe the visible text. */
function revised(message: ChatMessage, body: string, editedAt: number, revision: number | undefined): ChatMessage {
  const status = message.status && STATUS_RANK[message.status] > STATUS_RANK.sent ? 'sent' : message.status;
  return { ...message, body, editedAt, revision, receipts: undefined, status };
}

/** Shared pins per chat (like common messengers: a short, glanceable list). */
export const MAX_PINNED = 3;

function withPin(list: Conversation['pinnedMessages'], authorId: string, id: string, pinned: boolean, at: number, by: string): Conversation['pinnedMessages'] {
  const others = (list ?? []).filter((p) => p.authorId !== authorId || p.id !== id);
  const next = pinned ? [{ authorId, id, pinnedAt: at, by }, ...others].sort((a, b) => b.pinnedAt - a.pinnedAt).slice(0, MAX_PINNED) : others;
  return next.length ? next : undefined;
}

/** Prepared attachments waiting for the network (encrypted at rest by the local store). */
interface PendingUpload {
  id: string;
  conversationId: string;
  caption: string;
  files: (Omit<PreparedFile, 'data'> & { data: string; pointer?: AttachmentPointer; resume?: UploadResume })[];
  voice?: { durationMs: number };
  createdAt: number;
}

/** A community as shown to this account (COM-01). */
export interface CommunityView extends CommunityDto {
  /** Conversation ID of the root announcement channel. */
  conversationId: string;
  name: string;
  description: string;
}

/** Private onboarding progress (own devices only). */
export interface OnboardingProgress {
  items: Record<string, { done: boolean; counter: number }>;
  /** Rules version this account acknowledged; reviewers still waiting for delivery. */
  rulesAck?: { version: number; pending: string[] };
}

/** What the community overview needs for onboarding. */
export interface OnboardingView {
  pkg: OnboardingPackage;
  progress: OnboardingProgress;
  /** This account is a named rules reviewer. */
  reviewer: boolean;
  /** Reviewer only: audience members who acknowledged the current rules version. */
  rulesAcknowledged: string[];
  /** Members asked to acknowledge (everyone except reviewers and this account). */
  audience: string[];
}

/** A linked group with its E2EE label when known. */
export interface CommunityGroup extends CommunityLinkDto {
  conversationId: string;
  name?: string;
}

/** Sending to a blocked contact (unblock first). */
export class ContactBlockedError extends Error {
  constructor() { super('contact blocked'); this.name = 'ContactBlockedError'; }
}

/** The author tried to edit outside the edit window, or content that is not editable text. */
export class EditNotAllowedError extends Error {
  constructor() { super('edit not allowed'); this.name = 'EditNotAllowedError'; }
}

function applyReaction(message: ChatMessage, accountId: string, emoji: string, remove: boolean): ChatMessage {
  const reactions: Record<string, string[]> = {};
  for (const [e, ids] of Object.entries(message.reactions)) {
    const rest = ids.filter((id) => id !== accountId);
    if (rest.length > 0) reactions[e] = rest;
  }
  // One active reaction per account (latest wins).
  if (!remove) reactions[emoji] = [...(reactions[emoji] ?? []), accountId];
  return { ...message, reactions };
}

function tombstone(message: ChatMessage): ChatMessage {
  return { ...message, body: undefined, attachments: undefined, quote: undefined, reactions: {}, deleted: true, editedAt: undefined };
}

/** Do not destroy the last copy of the account encryption identity. */
export class LogoutRecoveryRequiredError extends Error {}
