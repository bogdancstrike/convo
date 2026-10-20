import { configureRecovery } from './recovery';
import { isProfile, type UserProfile } from './profile';
import { AccountHistory, type HistoryStatus } from './history';
import { fold, matchesMessage } from './search';
import { ApiError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { GatewaySocket, type ConnectionState } from '../api/socket';
import type { AccountDto, Directive, EnvelopeDto } from '../api/types';
import {
  CONTENT_VERSION,
  decodeContent,
  MAX_ATTACHMENTS,
  MAX_BODY_BYTES,
  type AttachmentPointer,
  newMessageId,
  type Content,
  type DataMessage,
  type Quote,
} from '../crypto/content';
import type { SignalStore } from '../crypto/signalStore';
import { Emitter } from '../lib/emitter';
import { Mutex } from '../lib/mutex';
import { utf8 } from '../lib/bytes';
import type { StoreOp } from '../storage/encryptedStore';
import { downloadAttachment, prepareFile, uploadAttachment } from './attachments';
import { replenishPreKeys } from './enrollment';
import { GroupManager, type GroupRecord } from './groups';
import { approveRequest, describeRequest, type IncomingLinkRequest } from './linking';
import { groupConversationId, groupIdOf, labelOf, STATUS_RANK, type ChatMessage, type Conversation, type DeviceState, type MessageStatus, type Settings } from './model';
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
}

/** Edit window for own messages (UI shows Edit only within it). */
export const EDIT_WINDOW_MS = 24 * 3600 * 1000;
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
    this.socket.on('state', (state) => {
      this.emit('connection', state);
      if (state === 'online') void this.outbox.flush();
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
    this.retryTimer = setInterval(() => void this.outbox.flush(), OUTBOX_RETRY_MS);
    void this.maintainGroups();
  }

  /** Keeps MLS KeyPackages stocked and this account's devices in sync across groups. */
  private async maintainGroups(): Promise<void> {
    try {
      await this.mutex.run(() => this.groups.ensureKeyPackages());
      await this.syncOwnDevicesInGroups();
    } catch (error) {
      console.warn('Group maintenance failed', error instanceof Error ? error.message : error);
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
    if (!conversation || conversation.unread === 0) return;
    const unread = await this.repos.messages(conversationId, conversation.unread);
    await this.saveConversations([{ ...conversation, unread: 0 }]);
    if (this.currentSettings.readReceipts && conversation.kind !== 'note') {
      const authors = new Set(unread.filter((m) => m.direction === 'in' && !m.deleted).map((m) => m.authorId));
      for (const author of authors) {
        const ids = unread.filter((m) => m.authorId === author && m.direction === 'in' && !m.deleted).map((m) => m.id);
        if (ids.length) await this.enqueue(author, receipt('read', ids, conversation.kind === 'group' ? conversationId : undefined), false);
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
    patch: Partial<Pick<Conversation, 'wallpaper' | 'pinned' | 'muted' | 'mutedUntil' | 'archived' | 'draft'>>,
  ): Promise<void> {
    const conversation = this.conversationCache.get(id);
    if (conversation) await this.saveConversations([{ ...conversation, ...patch }]);
  }

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
  async sendText(conversationId: string, body: string, quote?: Quote): Promise<void> {
    await this.sendMessage(conversationId, { body, quote });
  }

  /**
   * Encrypts and uploads files, then sends them (with an optional caption) as one message.
   * Uploads happen before the message is queued; a failed upload leaves nothing half-sent.
   *
   * @param onProgress called with the number of completed uploads
   */
  async sendAttachments(conversationId: string, files: File[], caption: string, onProgress?: (done: number) => void): Promise<void> {
    if (files.length === 0 || files.length > MAX_ATTACHMENTS) throw new Error('invalid attachment count');
    const pointers: AttachmentPointer[] = [];
    for (const file of files) {
      pointers.push(await uploadAttachment(this.api, await prepareFile(file)));
      onProgress?.(pointers.length);
    }
    await this.sendMessage(conversationId, { body: caption, attachments: pointers });
  }

  /** Encrypts, uploads and sends a recorded voice note. */
  async sendVoiceNote(conversationId: string, file: File, durationMs: number): Promise<void> {
    const pointer = await uploadAttachment(this.api, await prepareFile(file), { voiceNote: true, durationMs });
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
    content: { body?: string; quote?: Quote; attachments?: AttachmentPointer[]; forwarded?: boolean },
  ): Promise<void> {
    const text = content.body?.trim() || undefined;
    if (!text && !content.attachments?.length) throw new Error('empty message');
    if (text && utf8(text).length > MAX_BODY_BYTES) throw new Error('message too long');
    const groupId = groupIdOf(conversationId);
    const group = groupId ? await this.groups.record(groupId) : undefined;
    const recipients = group ? group.members.map((m) => m.accountId).filter((id) => id !== this.accountId) : conversationId !== this.accountId ? [conversationId] : [];
    const data: DataMessage = {
      recipientAccountIds: recipients,
      messageId: newMessageId(),
      timestamp: Date.now(),
      body: text,
      quote: content.quote,
      attachments: content.attachments,
      forwarded: content.forwarded || undefined,
      profile: this.profileCache.get(this.accountId),
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
    };
    const conversation = this.conversationCache.get(conversationId);
    const ops: StoreOp[] = [this.repos.putMessage(message)];
    if (conversation) {
      const updated = { ...conversation, lastActivity: data.timestamp, preview: previewOf(data), previewFromMe: true, previewAuthor: this.accountId, draft: undefined, archived: false };
      ops.push(this.repos.putConversation(updated));
      this.conversationCache.set(conversationId, updated);
    }
    await this.enqueue(conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, { conversationId, id: data.messageId }, ops);
    this.emit('messages', conversationId);
    this.emitConversations();
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

  /** Author edit (own messages only). */
  async edit(target: ChatMessage, body: string): Promise<void> {
    if (target.authorId !== this.accountId || target.deleted) throw new Error('only the author can edit');
    const text = body.trim();
    if (!text || text === target.body) return;
    const now = Date.now();
    const data: DataMessage = { messageId: newMessageId(), timestamp: now, edit: { targetMessageId: target.id, body: text } };
    await this.enqueue(target.conversationId, { v: CONTENT_VERSION, kind: 'data', data }, true, undefined, [
      this.repos.putMessage({ ...target, body: text, editedAt: now }),
    ]);
    this.emit('messages', target.conversationId);
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
  async removeGroupMember(conversationId: string, accountId: string): Promise<void> {
    const groupId = groupIdOf(conversationId)!;
    await this.mutex.run(() => this.groups.removeMember(groupId, accountId));
    this.emit('groups', groupId);
  }

  /** Sends the current group metadata so members (especially new ones) learn the name. */
  private async shareGroupMeta(record: GroupRecord): Promise<void> {
    await this.enqueue(record.groupId, { v: CONTENT_VERSION, kind: 'groupMeta', groupMeta: { name: record.name, version: record.metaVersion } }, false, undefined, [], true);
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
    if (!this.currentSettings.typingIndicators || conversation?.kind !== 'direct' || this.socket.state !== 'online') return;
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
    this.currentSettings = { ...this.currentSettings, ...patch };
    await this.repos.store.commit([this.repos.putSettings(this.currentSettings)]);
    this.emit('settings', this.currentSettings);
  }

  lastSeenPrivacy() { return this.api.lastSeenPrivacy(); }
  setLastSeenPrivacy(enabled: boolean) { return this.api.setLastSeenPrivacy(enabled); }
  lastSeenHeartbeat() { return this.api.lastSeenHeartbeat(); }
  lastSeen(accountId: string) { return this.api.lastSeen(accountId); }

  profiles(): Map<string, UserProfile> { return new Map(this.profileCache); }

  async updateProfile(patch: { photo?: string; status?: string }): Promise<void> {
    const profile: UserProfile = { accountId: this.accountId, status: '', ...this.profileCache.get(this.accountId), ...patch, updatedAt: Date.now() };
    if (!isProfile(profile)) throw new Error('invalid profile');
    await this.repos.store.put('profile', this.accountId, profile);
    this.profileCache.set(this.accountId, profile); this.emit('profiles', this.profiles());
    for (const conversation of this.conversations()) {
      if (conversation.kind === 'group' && (conversation.left || (conversation.adminOnly && (await this.groups.record(groupIdOf(conversation.id)!))?.members.find((m) => m.accountId === this.accountId)?.role === 'member'))) continue;
      await this.enqueue(conversation.id, { v: CONTENT_VERSION, kind: 'profile', profile }, false);
    }
    await this.enqueue(this.accountId, { v: CONTENT_VERSION, kind: 'profile', profile }, false);
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

    switch (content.kind) {
      case 'profile':
        this.stageProfile(content.profile, sender, ops);
        return followUps;
      case 'data': {
        if (fromSelf) return followUps; // own devices exchange data via sync transcripts
        const result = await this.applyData(sender, sender, 'in', content.data, envelope, ops, changed);
        if (result === 'new') {
          followUps.push(() => this.enqueue(sender, receipt('delivery', [content.data.messageId]), false));
          if (this.currentSettings.readReceipts && this.activeConversation === sender && document.visibilityState === 'visible') followUps.push(() => this.enqueue(sender, receipt('read', [content.data.messageId]), false));
          const ownProfile = this.profileCache.get(this.accountId);
          if (ownProfile && !content.data.profile) followUps.push(() => this.enqueue(sender, { v: CONTENT_VERSION, kind: 'profile', profile: ownProfile }, false));
        }
        return followUps;
      }
      case 'sync': {
        if (!fromSelf) return followUps; // only own devices may send sync content
        if (content.sync.sent) {
          const { destination, data } = content.sync.sent;
          await this.applyData(destination, this.accountId, 'out', data, envelope, ops, changed);
        }
        if (content.sync.read) {
          const c = this.conversationCache.get(content.sync.read.conversationId);
          if (c && c.unread > 0) this.stage(ops, { ...c, unread: 0 });
        }
        return followUps;
      }
      case 'receipt': {
        const conversationId = content.receipt.conversationId ?? sender;
        if (content.receipt.conversationId && !groupIdOf(conversationId)) return followUps;
        for (const id of content.receipt.messageIds) {
          const target = await this.repos.message(conversationId, this.accountId, id);
          if (!target || target.direction !== 'out' || target.deleted) continue;
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
    }
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
        if (applied === 'new' && accountId !== this.accountId) {
          followUps.push(() => this.enqueue(accountId, receipt('delivery', [content.data.messageId], conversationId), false));
          if (this.currentSettings.readReceipts && this.activeConversation === conversationId && document.visibilityState === 'visible') followUps.push(() => this.enqueue(accountId, receipt('read', [content.data.messageId], conversationId), false));
        }
      } else if (content.kind === 'profile') {
        this.stageProfile(content.profile, accountId, ops);
      } else if (content.kind === 'groupMeta') {
        await this.applyGroupMeta(result.groupId, content.groupMeta, ops);
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
  private async applyGroupMeta(groupId: string, meta: { name: string; version: number }, ops: StoreOp[]): Promise<void> {
    const record = await this.groups.record(groupId);
    if (!record || meta.version <= record.metaVersion) return;
    ops.push({ type: 'put', ns: 'group', id: groupId, value: { ...record, name: meta.name, metaVersion: meta.version } });
    const conversation = this.conversationCache.get(groupConversationId(groupId));
    if (conversation) this.stage(ops, { ...conversation, title: meta.name });
  }

  /** Reloads roles/members from the server ACL mirror after joins and commits. */
  private async refreshGroup(groupId: string): Promise<void> {
    const record = await this.groups.refreshRecord(groupId).catch(() => undefined);
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
  ): Promise<'new' | 'mutation' | 'ignored'> {
    if (data.profile) this.stageProfile(data.profile, authorId, ops);
    const targetId = data.reaction?.targetMessageId ?? data.edit?.targetMessageId ?? data.delete?.targetMessageId ?? data.messageId;
    const targetAuthor = data.reaction?.targetAuthorId ?? authorId;
    if (await this.repos.isLocallyDeleted({ conversationId, authorId: targetAuthor, id: targetId })) return 'ignored';
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
      // Only the original author may edit (specs §25.1).
      const target = await this.repos.message(conversation.id, authorId, data.edit.targetMessageId);
      if (!target || target.deleted || typeof data.edit.body !== 'string') return 'ignored';
      ops.push(this.repos.putMessage({ ...target, body: data.edit.body, editedAt: data.timestamp }));
      return 'mutation';
    }
    if (data.delete) {
      const target = await this.repos.message(conversation.id, authorId, data.delete.targetMessageId);
      if (!target) return 'ignored';
      ops.push(this.repos.putMessage(tombstone(target)));
      return 'mutation';
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
      sort: direction === 'out' ? data.timestamp : envelope.serverTimestamp,
      status: direction === 'out' ? 'sent' : undefined,
      reactions: {},
    };
    ops.push(this.repos.putMessage(message));
    const visible = this.activeConversation === conversation.id && document.visibilityState === 'visible';
    this.stage(ops, {
      ...conversation,
      lastActivity: Math.max(conversation.lastActivity, message.sort),
      preview: previewOf(data),
      previewFromMe: direction === 'out',
      previewAuthor: authorId,
      archived: conversation.archived && conversation.muted,
      unread: direction === 'in' && !visible ? conversation.unread + 1 : conversation.unread,
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
  ): Promise<void> {
    const groupId = group ? destination : groupIdOf(destination);
    const item = groupId
      ? Outbox.create({ destination: groupId, content, selfAccountId: this.accountId, syncTranscript: false, message, group: true })
      : Outbox.create({ destination, content, selfAccountId: this.accountId, syncTranscript, message });
    await this.repos.store.commit([...extraOps, Outbox.op(item)]);
    void this.outbox.flush();
  }

  private async onOutboxAccepted(item: OutboxItem): Promise<void> {
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
      case 'DEVICE_LIST_CHANGED':
        this.emit('devices', undefined);
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

function receipt(type: 'delivery' | 'read', messageIds: string[], conversationId?: string): Content {
  return { v: CONTENT_VERSION, kind: 'receipt', receipt: { type, messageIds, conversationId, timestamp: Date.now() } };
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
