import { ApiError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { GatewaySocket, type ConnectionState } from '../api/socket';
import type { AccountDto, Directive, EnvelopeDto } from '../api/types';
import {
  CONTENT_VERSION,
  decodeContent,
  MAX_BODY_BYTES,
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
import { replenishPreKeys } from './enrollment';
import { approveRequest, describeRequest, type IncomingLinkRequest } from './linking';
import { STATUS_RANK, type ChatMessage, type Conversation, type DeviceState, type MessageStatus, type Settings } from './model';
import { Outbox, type OutboxItem } from './outbox';
import type { Repositories } from './repositories';
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
  settings: Settings;
}

/** Edit window for own messages (UI shows Edit only within it). */
export const EDIT_WINDOW_MS = 24 * 3600 * 1000;
const TYPING_TTL_SECONDS = 10;
const OUTBOX_RETRY_MS = 15_000;

export class EnclaveClient extends Emitter<ClientEvents> {
  readonly socket: GatewaySocket;
  private readonly mutex = new Mutex();
  private readonly sessions: SessionManager;
  private readonly outbox: Outbox;
  private readonly conversationCache = new Map<string, Conversation>();
  private readonly accountCache = new Map<string, Promise<AccountDto | undefined>>();
  private activeConversation: string | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private currentSettings: Settings;

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
    this.outbox = new Outbox(repos.store, this.sessions, api, this.socket, device.accountId, {
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

  /** Loads local state and connects. */
  async start(): Promise<void> {
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
    this.socket.start();
    this.retryTimer = setInterval(() => void this.outbox.flush(), OUTBOX_RETRY_MS);
  }

  /** Disconnects (tab closing / leadership lost). */
  stop(): void {
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
  async openConversation(peer: { accountId: string; username: string }): Promise<Conversation> {
    const existing = this.conversationCache.get(peer.accountId);
    if (existing) return existing;
    const conversation = this.newConversation(peer.accountId, peer.username);
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
    if (this.currentSettings.readReceipts && conversation.kind === 'direct') {
      const ids = unread.filter((m) => m.direction === 'in' && !m.deleted).map((m) => m.id);
      if (ids.length > 0) await this.enqueue(conversationId, receipt('read', ids), false);
    }
    if (unread.length > 0) {
      await this.enqueue(this.accountId, {
        v: CONTENT_VERSION,
        kind: 'sync',
        sync: { read: { conversationId, upTo: unread[unread.length - 1]!.sort } },
      }, false);
    }
  }

  async updateConversation(id: string, patch: Partial<Pick<Conversation, 'pinned' | 'muted' | 'archived' | 'draft'>>): Promise<void> {
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
    const text = body.trim();
    if (!text) throw new Error('empty message');
    if (utf8(text).length > MAX_BODY_BYTES) throw new Error('message too long');
    const data: DataMessage = { messageId: newMessageId(), timestamp: Date.now(), body: text, quote };
    const message: ChatMessage = {
      conversationId,
      id: data.messageId,
      authorId: this.accountId,
      direction: 'out',
      body: text,
      quote,
      sentAt: data.timestamp,
      sort: data.timestamp,
      status: 'queued',
      reactions: {},
    };
    const conversation = this.conversationCache.get(conversationId);
    const ops: StoreOp[] = [this.repos.putMessage(message)];
    if (conversation) {
      const updated = { ...conversation, lastActivity: data.timestamp, preview: text, draft: undefined, archived: false };
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

  /** Deletes a message on this device only. */
  async deleteLocally(target: ChatMessage): Promise<void> {
    await this.repos.store.commit([{ type: 'deleteMessage', conversationId: target.conversationId, messageKey: `${target.authorId}/${target.id}` }]);
    this.emit('messages', target.conversationId);
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
      case 'data': {
        if (fromSelf) return followUps; // own devices exchange data via sync transcripts
        const result = await this.applyData(sender, sender, 'in', content.data, envelope, ops, changed);
        if (result === 'new') followUps.push(() => this.enqueue(sender, receipt('delivery', [content.data.messageId]), false));
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
        const rank = content.receipt.type === 'read' ? 'read' : 'delivered';
        for (const id of content.receipt.messageIds.slice(0, 500)) {
          const target = await this.repos.message(sender, this.accountId, id);
          if (target && STATUS_RANK[rank] > STATUS_RANK[target.status ?? 'sent']) {
            ops.push(this.repos.putMessage({ ...target, status: rank }));
            changed.add(sender);
          }
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
    }
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
    if (data.body === undefined) return 'ignored';
    if (await this.repos.message(conversation.id, authorId, data.messageId)) return 'ignored'; // semantic dedupe

    const message: ChatMessage = {
      conversationId: conversation.id,
      id: data.messageId,
      authorId,
      direction,
      body: data.body,
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
      preview: data.body,
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
    const title = id === this.accountId ? this.device.username : ((await this.lookupAccount(id))?.username ?? 'Unknown');
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

  private async enqueue(
    destination: string,
    content: Content,
    syncTranscript: boolean,
    message?: { conversationId: string; id: string },
    extraOps: StoreOp[] = [],
  ): Promise<void> {
    const item = Outbox.create({ destination, content, selfAccountId: this.accountId, syncTranscript, message });
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
      case 'DEVICE_LIST_CHANGED':
        this.emit('devices', undefined);
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

function receipt(type: 'delivery' | 'read', messageIds: string[]): Content {
  return { v: CONTENT_VERSION, kind: 'receipt', receipt: { type, messageIds, timestamp: Date.now() } };
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
  return { ...message, body: undefined, quote: undefined, reactions: {}, deleted: true, editedAt: undefined };
}
