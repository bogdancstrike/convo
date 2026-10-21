import { isProfile, type UserProfile } from '../core/profile';
import { fromUtf8, randomBytes, toBase64Url, utf8 } from '../lib/bytes';
import { pad, unpad } from './padding';

/**
 * End-to-end encrypted content schema (specs §11, §25). This is the plaintext inside Signal
 * ciphertext; the server never sees it.
 *
 * Encoding: JSON → UTF-8 → {@link pad}. Every content carries `v` (schema version). Unknown
 * `kind`s or newer versions decode to {@link UnknownContent} so the UI can show "Update needed to
 * view this item" instead of failing (specs §25.1).
 */
export const CONTENT_VERSION = 1;

/** Maximum UTF-8 body length (specs §26.3: 64 KiB). */
export const MAX_BODY_BYTES = 64 * 1024;

/** A quoted reply reference. */
export interface Quote {
  messageId: string;
  authorId: string;
  /** Short local excerpt for display if the original is unavailable. */
  excerpt?: string;
}

/** Maximum attachments per message (specs §26.3). */
export const MAX_ATTACHMENTS = 10;

/**
 * Pointer to an encrypted attachment (specs §7.1 `AttachmentPointer`). The key and digest exist
 * only inside E2EE content; the server knows the opaque ID and ciphertext size.
 */
export interface AttachmentPointer {
  attachmentId: string;
  /** AES-256 key (base64url). */
  key: string;
  /** SHA-256 of the padded ciphertext (base64url). */
  digest: string;
  /** Plaintext size in bytes. */
  size: number;
  contentType: string;
  fileName?: string;
  width?: number;
  height?: number;
  /** Recorded in the app as a voice note (rendered as an inline player). */
  voiceNote?: boolean;
  /** Media duration in milliseconds, when known. */
  durationMs?: number;
  /** Small JPEG preview (base64url) for videos; travels only inside E2EE content. */
  thumbnail?: string;
}

/** Maximum encoded thumbnail size inside content. */
export const MAX_THUMBNAIL_CHARS = 64 * 1024;

/** Reaction toggle on a target message. */
export interface Reaction {
  targetMessageId: string;
  targetAuthorId: string;
  emoji: string;
  remove: boolean;
}

/** Author edit of an earlier message. */
export interface Edit {
  targetMessageId: string;
  body: string;
  /** Strictly increasing per target message (1 for the first edit). */
  revision?: number;
}

/** Author delete-for-everyone request. */
export interface Delete {
  targetMessageId: string;
}

/** A user-visible message or mutation. Exactly one of body/reaction/edit/delete is meaningful. */
export interface DataMessage {
  profile?: UserProfile;
  recipientAccountIds?: string[];
  messageId: string;
  timestamp: number;
  body?: string;
  attachments?: AttachmentPointer[];
  /** Explicitly forwarded by the sender (shown as "Forwarded", specs §25.1). */
  forwarded?: boolean;
  quote?: Quote;
  reaction?: Reaction;
  edit?: Edit;
  delete?: Delete;
  /** Disappearing timer (seconds) this message uses. */
  expireTimer?: number;
  /** Group members mentioned in `body` (account IDs; the text carries `@Name`). */
  mentions?: string[];
  /** Conversation event: the disappearing timer changed. */
  timerUpdate?: { seconds: number };
  /** Group event: the author left the group (shown as a notice). */
  left?: boolean;
  /** Conversation event: a message was pinned/unpinned for everyone. */
  pin?: { targetMessageId: string; targetAuthorId: string; pinned: boolean };
  /** Community announcement asking for an explicit acknowledgement (specs §30.6). */
  ackRequest?: AckRequest;
}

/**
 * Acknowledgement request bound to one announcement. Reviewers (≤ 10, owners/admins) receive
 * individual responses; the audience is fixed when the announcement is published.
 */
export interface AckRequest {
  requestId: string;
  revision: number;
  reviewers: string[];
  audience: string[];
  /** Optional due time (ms): later responses are still accepted but marked late. */
  due?: number;
  /** Optional closing time (ms): the request closes and new responses are rejected. */
  expires?: number;
}

/**
 * An explicit acknowledgement, sent pairwise to each named reviewer and synced to the sender's
 * own devices. Never a post: it carries no announcement text, only IDs and revisions.
 */
export interface AckResponse {
  requestId: string;
  requestRevision: number;
  /** Community root conversation (`g:<groupId>`), announcement ID and author. */
  conversationId: string;
  messageId: string;
  authorId: string;
  /** Announcement content revision that was acknowledged (edits require a new response). */
  contentRevision: number;
  timestamp: number;
}

/** Delivery/read receipt for messages sent by the receiver of this content. */
export interface ReceiptMessage {
  type: 'delivery' | 'read';
  conversationId?: string;
  messageIds: string[];
  /** Content revision acknowledged for each message ID (same order); absent means 0. */
  revisions?: number[];
  timestamp: number;
}

/** Own-device synchronization. */
export interface SyncMessage {
  /** Transcript of a message this account sent from another device. */
  sent?: { destination: string; data: DataMessage };
  /** Read cursor of a conversation advanced on another device. */
  read?: { conversationId: string; upTo: number };
  /** Conversation snooze (own devices only; higher mutation wins; `until: null` ends it). */
  snooze?: { conversationId: string; until: number | null; zone: string; mutation: number };
  /** Private onboarding checklist progress (own devices only; higher counter wins). */
  onboarding?: { conversationId: string; itemId: string; done: boolean; counter: number };
}

/**
 * End-to-end encrypted group metadata (specs §11 `GroupMetadataUpdate`). Highest version wins;
 * ties keep the current value.
 */
export interface GroupMeta {
  name: string;
  version: number;
  /** About text (specs §30.8, ≤ 8 KiB UTF-8): plain text with the safe message formatting. */
  description?: string;
  /**
   * Community root only (COM-01): description and labels of linked groups that a community admin
   * who is also in that group published after the link became active. Accepted only from the
   * root's owners/admins; labels are shown only for links the server reports active.
   */
  community?: CommunityMeta;
}

export interface CommunityMeta {
  description: string;
  links: { groupId: string; name: string }[];
  /** Newcomer onboarding package (specs §30.7), edited by root owners/admins. */
  onboarding?: OnboardingPackage;
}

/** Versioned onboarding package. `revision` changes on every edit; rules keep their own version. */
export interface OnboardingPackage {
  revision: number;
  /** Account that published this revision (must be a root owner/admin). */
  editor: string;
  welcome: string;
  rules?: { version: number; text: string; digest: string; ackRequired: boolean; reviewers: string[] };
  /** Recommended linked groups (discoverable ones only; never auto-joined). */
  recommended: string[];
  checklist: { id: string; label: string; required: boolean }[];
  contact?: string;
}

/** Explicit acknowledgement of a community's rules version, sent to the named reviewers. */
export interface RulesAck {
  conversationId: string;
  version: number;
  digest: string;
  timestamp: number;
}

/**
 * Call signalling, carried end-to-end encrypted like any message. `ring` contains the random
 * media key the LiveKit frame cryptor uses; the SFU and the server never learn it.
 */
export interface CallMessage {
  callId: string;
  action: 'ring' | 'accept' | 'decline' | 'cancel' | 'end' | 'busy' | 'rekey';
  video?: boolean;
  /** base64url 32-byte media key (ring and rekey). */
  key?: string;
  /**
   * Group calls: key generation (ring = 0). `rekey` replaces the media key after someone left the
   * room; it travels through the MLS group, so members removed from the group never receive it.
   */
  generation?: number;
  /** Direct calls: the callee account, so the caller's other devices know the conversation. */
  to?: string;
  timestamp: number;
}

/** Typing indicator (transient, off by default). */
export interface TypingMessage {
  action: 'started' | 'stopped';
  timestamp: number;
}

export type Content =
  | { v: number; kind: 'data'; data: DataMessage }
  | { v: number; kind: 'receipt'; receipt: ReceiptMessage }
  | { v: number; kind: 'sync'; sync: SyncMessage }
  | { v: number; kind: 'typing'; typing: TypingMessage }
  | { v: number; kind: 'call'; call: CallMessage }
  | { v: number; kind: 'groupMeta'; groupMeta: GroupMeta }
  | { v: number; kind: 'profile'; profile: UserProfile }
  | { v: number; kind: 'ack'; ack: AckResponse }
  | { v: number; kind: 'rulesAck'; rulesAck: RulesAck };

/** Content this client cannot interpret. */
export interface UnknownContent {
  v: number;
  kind: 'unknown';
}

/** Generates a 16-byte random message ID (specs §2). */
export function newMessageId(): string {
  return toBase64Url(randomBytes(16));
}

/** Serializes and pads content for encryption. */
export function encodeContent(content: Content): Uint8Array<ArrayBuffer> {
  return pad(utf8(JSON.stringify(content)));
}

/**
 * Unpads and parses decrypted content, validating the structure of known kinds.
 *
 * @throws Error on malformed padding/JSON or invalid known-kind payloads
 */
export function decodeContent(bytes: Uint8Array): Content | UnknownContent {
  const parsed: unknown = JSON.parse(fromUtf8(unpad(bytes)));
  if (!isObject(parsed) || typeof parsed.v !== 'number' || typeof parsed.kind !== 'string') {
    throw new Error('malformed content');
  }
  switch (parsed.kind) {
    case 'profile':
      if (!isProfile(parsed.profile)) throw new Error('malformed profile');
      return parsed as unknown as Content;
    case 'data':
      if (!isDataMessage(parsed.data)) throw new Error('malformed data message');
      return parsed as unknown as Content;
    case 'receipt':
      if (!isObject(parsed.receipt) || !Array.isArray(parsed.receipt.messageIds) || parsed.receipt.messageIds.length > 500 || !parsed.receipt.messageIds.every((id) => typeof id === 'string') || !['delivery', 'read'].includes(String(parsed.receipt.type)) || !Number.isFinite(parsed.receipt.timestamp) || (parsed.receipt.conversationId !== undefined && typeof parsed.receipt.conversationId !== 'string') || (parsed.receipt.revisions !== undefined && (!Array.isArray(parsed.receipt.revisions) || parsed.receipt.revisions.length !== parsed.receipt.messageIds.length || !parsed.receipt.revisions.every(isRevision)))) throw new Error('malformed receipt');
      return parsed as unknown as Content;
    case 'sync':
      if (!isObject(parsed.sync)) throw new Error('malformed sync');
      if (parsed.sync.sent !== undefined && (!isObject(parsed.sync.sent) || !isDataMessage(parsed.sync.sent.data))) {
        throw new Error('malformed sync transcript');
      }
      if (parsed.sync.snooze !== undefined) {
        const z = parsed.sync.snooze;
        if (!isObject(z) || typeof z.conversationId !== 'string' || z.conversationId.length > 80 || !(z.until === null || Number.isSafeInteger(z.until))
          || typeof z.zone !== 'string' || z.zone.length > 64 || !Number.isSafeInteger(z.mutation)) throw new Error('malformed snooze sync');
      }
      if (parsed.sync.onboarding !== undefined) {
        const o = parsed.sync.onboarding;
        if (!isObject(o) || typeof o.conversationId !== 'string' || typeof o.itemId !== 'string' || !ID.test(o.itemId)
          || typeof o.done !== 'boolean' || !Number.isSafeInteger(o.counter)) throw new Error('malformed onboarding sync');
      }
      return parsed as unknown as Content;
    case 'typing':
      return parsed as unknown as Content;
    case 'call':
      if (!isCallMessage(parsed.call)) throw new Error('malformed call message');
      return parsed as unknown as Content;
    case 'ack':
      if (!isAckResponse(parsed.ack)) throw new Error('malformed acknowledgement');
      return parsed as unknown as Content;
    case 'rulesAck':
      if (!isRulesAck(parsed.rulesAck)) throw new Error('malformed rules acknowledgement');
      return parsed as unknown as Content;
    case 'groupMeta':
      if (
        !isObject(parsed.groupMeta) ||
        typeof parsed.groupMeta.name !== 'string' ||
        parsed.groupMeta.name.length > 128 ||
        typeof parsed.groupMeta.version !== 'number' ||
        (parsed.groupMeta.description !== undefined && (typeof parsed.groupMeta.description !== 'string' || utf8(parsed.groupMeta.description).length > MAX_DESCRIPTION_BYTES)) ||
        (parsed.groupMeta.community !== undefined && !isCommunityMeta(parsed.groupMeta.community))
      ) {
        throw new Error('malformed group metadata');
      }
      return parsed as unknown as Content;
    default:
      return { v: parsed.v, kind: 'unknown' };
  }
}

/** Group/community About text budget (specs §30.8). */
export const MAX_DESCRIPTION_BYTES = 8192;

const CALL_ACTIONS = new Set(['ring', 'accept', 'decline', 'cancel', 'end', 'busy', 'rekey']);
function isCallMessage(value: unknown): value is CallMessage {
  return isObject(value) && typeof value.callId === 'string' && /^[0-9a-f-]{36}$/.test(value.callId) && CALL_ACTIONS.has(String(value.action))
    && Number.isFinite(value.timestamp) && (value.video === undefined || typeof value.video === 'boolean')
    && (value.to === undefined || typeof value.to === 'string')
    && (value.key === undefined || (typeof value.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.key)))
    && (value.generation === undefined || (Number.isSafeInteger(value.generation) && (value.generation as number) >= 0 && (value.generation as number) < 2 ** 31))
    && (value.action !== 'ring' || typeof value.key === 'string')
    && (value.action !== 'rekey' || (typeof value.key === 'string' && typeof value.generation === 'number' && value.generation > 0));
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
function isIdList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((id) => typeof id === 'string' && ID.test(id));
}

function isAckRequest(value: unknown): value is AckRequest {
  return isObject(value) && typeof value.requestId === 'string' && ID.test(value.requestId) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1
    && isIdList(value.reviewers, 10) && (value.reviewers as string[]).length >= 1 && isIdList(value.audience, 5000)
    && (value.due === undefined || isTime(value.due)) && (value.expires === undefined || isTime(value.expires))
    && (value.due === undefined || value.expires === undefined || (value.due as number) <= (value.expires as number));
}

function isTime(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isAckResponse(value: unknown): value is AckResponse {
  return isObject(value) && typeof value.requestId === 'string' && ID.test(value.requestId) && Number.isSafeInteger(value.requestRevision)
    && typeof value.conversationId === 'string' && /^g:[A-Za-z0-9_-]{43}$/.test(value.conversationId)
    && typeof value.messageId === 'string' && ID.test(value.messageId) && typeof value.authorId === 'string' && ID.test(value.authorId)
    && isRevision(value.contentRevision) && Number.isFinite(value.timestamp);
}

function isCommunityMeta(value: unknown): value is CommunityMeta {
  return isObject(value) && typeof value.description === 'string' && value.description.length <= 1000 && Array.isArray(value.links)
    && value.links.length <= 50 && value.links.every((l) => isObject(l) && typeof l.groupId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(l.groupId)
      && typeof l.name === 'string' && l.name.length > 0 && l.name.length <= 128)
    && (value.onboarding === undefined || isOnboarding(value.onboarding));
}

const GROUP_ID = /^[A-Za-z0-9_-]{43}$/;
function isOnboarding(value: unknown): value is OnboardingPackage {
  if (!isObject(value) || !Number.isSafeInteger(value.revision) || typeof value.editor !== 'string' || !ID.test(value.editor)) return false;
  if (typeof value.welcome !== 'string' || value.welcome.length > 4000) return false;
  if (value.contact !== undefined && (typeof value.contact !== 'string' || value.contact.length > 200)) return false;
  if (!Array.isArray(value.recommended) || value.recommended.length > 20 || !value.recommended.every((g) => typeof g === 'string' && GROUP_ID.test(g))) return false;
  if (!Array.isArray(value.checklist) || value.checklist.length > 20 || !value.checklist.every((i) => isObject(i) && typeof i.id === 'string' && ID.test(i.id)
    && typeof i.label === 'string' && i.label.length > 0 && i.label.length <= 120 && typeof i.required === 'boolean')) return false;
  if (value.rules !== undefined) {
    const r = value.rules;
    if (!isObject(r) || !Number.isSafeInteger(r.version) || (r.version as number) < 1 || typeof r.text !== 'string' || r.text.length > 8000
      || typeof r.digest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.digest) || typeof r.ackRequired !== 'boolean' || !isIdList(r.reviewers, 10)) return false;
  }
  return true;
}

function isRulesAck(value: unknown): value is RulesAck {
  return isObject(value) && typeof value.conversationId === 'string' && /^g:[A-Za-z0-9_-]{43}$/.test(value.conversationId)
    && Number.isSafeInteger(value.version) && typeof value.digest === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.digest) && Number.isFinite(value.timestamp);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataMessage(value: unknown): value is DataMessage {
  if (!isObject(value)) return false;
  if (typeof value.messageId !== 'string' || typeof value.timestamp !== 'number') return false;
  if (value.recipientAccountIds !== undefined && (!Array.isArray(value.recipientAccountIds) || value.recipientAccountIds.length > 1000 || !value.recipientAccountIds.every((id) => typeof id === 'string'))) return false;
  if (value.profile !== undefined && !isProfile(value.profile)) return false;
  if (value.pin !== undefined && (!isObject(value.pin) || typeof value.pin.targetMessageId !== 'string' || typeof value.pin.targetAuthorId !== 'string' || typeof value.pin.pinned !== 'boolean')) return false;
  if (value.mentions !== undefined && (!Array.isArray(value.mentions) || value.mentions.length > 50 || !value.mentions.every((id) => typeof id === 'string' && id.length <= 64))) return false;
  if (value.expireTimer !== undefined && !(Number.isSafeInteger(value.expireTimer) && (value.expireTimer as number) >= 0 && (value.expireTimer as number) <= 366 * 24 * 3600)) return false;
  if (value.timerUpdate !== undefined && (!isObject(value.timerUpdate) || !Number.isSafeInteger(value.timerUpdate.seconds) || (value.timerUpdate.seconds as number) < 0)) return false;
  if (value.edit !== undefined && (!isObject(value.edit) || typeof value.edit.targetMessageId !== 'string' || typeof value.edit.body !== 'string'
    || utf8(value.edit.body).length > MAX_BODY_BYTES || (value.edit.revision !== undefined && !isRevision(value.edit.revision)))) return false;
  if (value.body !== undefined && (typeof value.body !== 'string' || utf8(value.body).length > MAX_BODY_BYTES)) return false;
  if (value.ackRequest !== undefined && !isAckRequest(value.ackRequest)) return false;
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > MAX_ATTACHMENTS) return false;
    if (!value.attachments.every(isAttachmentPointer)) return false;
  }
  return true;
}

function isAttachmentPointer(value: unknown): value is AttachmentPointer {
  return (
    isObject(value) &&
    typeof value.attachmentId === 'string' &&
    /^[0-9a-f-]{36}$/.test(value.attachmentId) &&
    typeof value.key === 'string' &&
    typeof value.digest === 'string' &&
    typeof value.size === 'number' &&
    value.size >= 0 &&
    typeof value.contentType === 'string' &&
    value.contentType.length <= 128 &&
    (value.fileName === undefined || (typeof value.fileName === 'string' && value.fileName.length <= 255)) &&
    (value.thumbnail === undefined || (typeof value.thumbnail === 'string' && value.thumbnail.length <= MAX_THUMBNAIL_CHARS))
  );
}
