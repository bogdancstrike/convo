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
}

/**
 * End-to-end encrypted group metadata (specs §11 `GroupMetadataUpdate`). Highest version wins;
 * ties keep the current value.
 */
export interface GroupMeta {
  name: string;
  version: number;
}

/**
 * Call signalling, carried end-to-end encrypted like any message. `ring` contains the random
 * media key the LiveKit frame cryptor uses; the SFU and the server never learn it.
 */
export interface CallMessage {
  callId: string;
  action: 'ring' | 'accept' | 'decline' | 'cancel' | 'end' | 'busy';
  video?: boolean;
  /** base64url 32-byte media key (ring only). */
  key?: string;
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
  | { v: number; kind: 'profile'; profile: UserProfile };

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
      return parsed as unknown as Content;
    case 'typing':
      return parsed as unknown as Content;
    case 'call':
      if (!isCallMessage(parsed.call)) throw new Error('malformed call message');
      return parsed as unknown as Content;
    case 'groupMeta':
      if (
        !isObject(parsed.groupMeta) ||
        typeof parsed.groupMeta.name !== 'string' ||
        parsed.groupMeta.name.length > 128 ||
        typeof parsed.groupMeta.version !== 'number'
      ) {
        throw new Error('malformed group metadata');
      }
      return parsed as unknown as Content;
    default:
      return { v: parsed.v, kind: 'unknown' };
  }
}

const CALL_ACTIONS = new Set(['ring', 'accept', 'decline', 'cancel', 'end', 'busy']);
function isCallMessage(value: unknown): value is CallMessage {
  return isObject(value) && typeof value.callId === 'string' && /^[0-9a-f-]{36}$/.test(value.callId) && CALL_ACTIONS.has(String(value.action))
    && Number.isFinite(value.timestamp) && (value.video === undefined || typeof value.video === 'boolean')
    && (value.to === undefined || typeof value.to === 'string')
    && (value.key === undefined || (typeof value.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.key)))
    && (value.action !== 'ring' || typeof value.key === 'string');
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
  if (value.mentions !== undefined && (!Array.isArray(value.mentions) || value.mentions.length > 50 || !value.mentions.every((id) => typeof id === 'string' && id.length <= 64))) return false;
  if (value.expireTimer !== undefined && !(Number.isSafeInteger(value.expireTimer) && (value.expireTimer as number) >= 0 && (value.expireTimer as number) <= 366 * 24 * 3600)) return false;
  if (value.timerUpdate !== undefined && (!isObject(value.timerUpdate) || !Number.isSafeInteger(value.timerUpdate.seconds) || (value.timerUpdate.seconds as number) < 0)) return false;
  if (value.edit !== undefined && (!isObject(value.edit) || typeof value.edit.targetMessageId !== 'string' || typeof value.edit.body !== 'string'
    || utf8(value.edit.body).length > MAX_BODY_BYTES || (value.edit.revision !== undefined && !isRevision(value.edit.revision)))) return false;
  if (value.body !== undefined && (typeof value.body !== 'string' || utf8(value.body).length > MAX_BODY_BYTES)) return false;
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
