import type { MemberPolicy } from './memberPolicy';
import type { Topic } from './topics';
import type { AbuseReport } from '../crypto/content';
import type { EventState } from './events';
import type { PollState } from './polls';
import { DEFAULT_AUTO_DOWNLOAD, type AutoDownloadSettings } from './mediaPolicy';
import type { AttachmentPointer, Quote } from '../crypto/content';

/**
 * Local domain model rendered by the UI. Everything here is end-to-end data that exists only on
 * the user's devices (specs §13 "explicitly not stored": conversations, read state).
 */

/**
 * Outgoing delivery state (UI.md §5.2). `queued` = waiting for connection, `sending` = submission
 * in progress, `sent` = durably accepted by the server, `delivered`/`read` = recipient receipts.
 */
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'blocked';

/** Ordering of statuses for monotonic receipt updates. */
export const STATUS_RANK: Record<MessageStatus, number> = {
  failed: 0,
  blocked: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

export interface ChatMessage {
  conversationId: string;
  /** Sender-chosen 16-byte message ID (base64url). */
  id: string;
  authorId: string;
  direction: 'in' | 'out';
  body?: string;
  attachments?: AttachmentPointer[];
  quote?: Quote;
  /** Sender's timestamp (ms). */
  sentAt: number;
  /** Local ordering key: server time for incoming, send time for outgoing. */
  sort: number;
  status?: MessageStatus;
  /** Recipients at send time; receipt senders must belong to this snapshot. */
  recipientAccountIds?: string[];
  receipts?: Record<string, { deliveredAt?: number; readAt?: number }>;

  /** emoji → reacting account IDs. */
  reactions: Record<string, string[]>;
  editedAt?: number;
  /** Disappearing-message timer (seconds) the sender applied. */
  expireTimer?: number;
  /** Files waiting for the network (offline-queued upload placeholder). */
  pendingFiles?: { name: string; size: number; contentType: string }[];
  /** Mentioned account IDs (groups). */
  mentions?: string[];
  /** Deadline after which this device deletes the message. */
  expiresAt?: number;
  /** System notice instead of content (e.g. disappearing timer changed). */
  notice?: { kind: 'timer'; seconds: number } | { kind: 'left' } | { kind: 'device'; change: 'added' | 'removed'; deviceId: number; platform: string };
  /** Content revision: 0/undefined for the original text, incremented by each accepted edit. */
  revision?: number;
  /** Server time of the envelope that delivered the original (anchors the edit window). */
  serverAt?: number;
  deleted?: boolean;
  /** Received or sent as a forward. */
  forwarded?: boolean;
  /** Private bookmark on this device (never sent). */
  starred?: boolean;
  /** Content this client version cannot render (UI shows "Update needed"). */
  unsupported?: boolean;
  /** Content that could not be decrypted. */
  undecryptable?: boolean;
  /** Sanitized failure reason for outgoing messages. */
  error?: string;
  /** Community announcement: acknowledgement request (validated author/reviewers). */
  ackRequest?: import('../crypto/content').AckRequest;
  /** Reviewer only: responses received (account → time and acknowledged content revision). */
  acks?: Record<string, { at: number; revision: number; late?: boolean }>;
  /** Audience member: own response (content revision; reviewers still waiting for delivery). */
  myAck?: { revision: number; at: number; pending: string[] };
  /** Reviewer side: when each member last withdrew (server time); older acknowledgements are ignored. */
  ackWithdrawn?: Record<string, number>;
  /** This account's own withdrawal time, so a late echo of the earlier response does not restore it. */
  myAckWithdrawnAt?: number;
  /** Poll message: definition, current ballots and close state (see core/polls.ts). */
  poll?: PollState;
  /** Event message: details, revision, cancellation and RSVPs (see core/events.ts). */
  event?: EventState;
  /**
   * View-once photo/video. `unopened` keeps the attachment pointer until it is viewed; `opened`
   * (or `sent` on the sender's side) has no pointer any more, only the label remains.
   */
  viewOnce?: { kind: 'photo' | 'video'; state: 'unopened' | 'opened' | 'sent'; at?: number };
  /** Abuse report received from (or sent to) a security contact. */
  report?: AbuseReport;
  /** Group topic this message belongs to (absent = general). */
  topic?: string;
  /** A bundled sticker (`core/stickers.ts`). */
  sticker?: { pack: string; id: string };
}

export interface Conversation {
  wallpaper?: Settings['wallpaper'];
  /** Channel: only owners/admins may publish application messages. */
  adminOnly?: boolean;
  /** Peer account ID for direct chats; own account ID for Note to self; `g:<groupId>` for groups. */
  id: string;
  kind: 'direct' | 'note' | 'group';
  title: string;
  lastActivity: number;
  preview?: string;
  unread: number;
  /** Messages pinned for everyone (newest first, at most MAX_PINNED). */
  pinnedMessages?: { authorId: string; id: string; pinnedAt: number; by: string }[];
  /** Group topics (specs §30.4), defined by owners/admins. */
  topics?: Topic[];
  /** Slow mode and restricted members (groups; owners/admins). */
  memberPolicy?: MemberPolicy;
  /** Slow mode bookkeeping: when each member's last accepted post was sent/received. */
  lastPostAt?: Record<string, number>;
  /** Groups: alert for every message or only when this account is mentioned (mute = none). */
  notify?: 'all' | 'mentions';
  /** An unread message mentions this account (cleared when read). */
  mentioned?: boolean;
  /** Direct chat started by someone new: no read receipts, typing or profile until accepted. */
  request?: boolean;
  /** Direct chat: this account blocked the peer (their direct content is dropped on arrival). */
  blocked?: boolean;
  /** When `blocked` last changed (last writer wins across own devices). */
  blockedChangedAt?: number;
  /** Disappearing-message timer in seconds (0/absent = off). */
  expireSeconds?: number;
  /** Sender timestamp of the timer change in effect (last writer wins). */
  expireUpdatedAt?: number;
  /** Incoming messages edited while not on screen; their new revision still needs a read receipt. */
  revisedUnread?: { authorId: string; id: string }[];
  pinned: boolean;
  muted: boolean;
  /** Timed snooze overlay (specs §30.8); the underlying mute/notify mode is unchanged. */
  snooze?: import('./snooze').Snooze;
  /** Snooze mutation counter (own-device sync: higher wins; expiry is persisted, never revived). */
  snoozeMutation?: number;
  /** Mute expiry (epoch ms); absent with `muted` means "always". */
  mutedUntil?: number;
  /** The preview is the user's own message (list shows "You:"). */
  previewFromMe?: boolean;
  /** Author of the preview message in groups. */
  previewAuthor?: string;
  archived: boolean;
  draft?: string;
  /** Set when the peer's identity key changed and the user has not acknowledged it. */
  identityChangedAt?: number;
  /** Groups: this account is no longer a member (removed or left). */
  left?: boolean;
}

/** Whether notifications are currently muted for a conversation. */
export function isMuted(c: Conversation, now = Date.now()): boolean {
  return c.muted && (c.mutedUntil === undefined || c.mutedUntil > now);
}

/** Conversation ID of a group. */
export function groupConversationId(groupId: string): string {
  return `g:${groupId}`;
}

/** Group ID of a group conversation, or undefined for direct chats. */
export function groupIdOf(conversationId: string): string | undefined {
  return conversationId.startsWith('g:') ? conversationId.slice(2) : undefined;
}

/** Device-local preferences (privacy defaults from specs §25.1: receipts/typing off). */
export interface Settings {
  readReceipts: boolean;
  typingIndicators: boolean;
  theme: 'system' | 'light' | 'dark';
  locale: 'en' | 'ro';
  enterToSend: boolean;
  confirmExternalLinks: boolean;
  animations: boolean;
  wallpaper: 'dots' | 'plain' | 'ocean' | 'botanical';
  /** Media fetched and decrypted automatically, per network (see mediaPolicy.ts). */
  autoDownload: AutoDownloadSettings;
  /** Android only: export received photos/videos to the shared gallery (plaintext copies). */
  saveToGallery: boolean;
  /** Chats that require passkey user verification to open on this device (ids; device-local). */
  lockedChats: string[];
  /** Ask for the passkey when Convo opens and after being hidden (device-local). */
  appLock: boolean;
  /** Minutes in the background before the app lock engages again (0 = immediately). */
  appLockAfterMinutes: 0 | 1 | 5 | 15;
  /** Show system notifications for new messages on this device. */
  notifications: boolean;
  /** Notification content: nothing identifying (default), sender only, or sender and text. */
  notificationPreview: 'generic' | 'sender' | 'full';
  /** Minutes before an event I answered Going/Maybe to remind me on this device (0 = off). */
  eventReminderMinutes: 0 | 5 | 15 | 30 | 60;
}

export const DEFAULT_SETTINGS: Settings = {
  readReceipts: false,
  typingIndicators: false,
  theme: 'system',
  locale: 'en',
  enterToSend: true,
  confirmExternalLinks: true,
  animations: true,
  wallpaper: 'dots',
  autoDownload: DEFAULT_AUTO_DOWNLOAD,
  saveToGallery: false,
  lockedChats: [],
  appLock: false,
  appLockAfterMinutes: 1,
  notifications: false,
  notificationPreview: 'generic',
  eventReminderMinutes: 15,
};

/** Persistent identity of this enrolled device. */
export interface DeviceState {
  accountId: string;
  deviceId: number;
  username: string;
  /** Organization display name, if the IdP provides one. */
  displayName?: string;
  deploymentId: string;
  registeredAt: number;
  /** Next one-time prekey ID to allocate. */
  nextPreKeyId: number;
}

/** Best human label for an account: organization display name, else `@handle`. */
export function labelOf(account: { username: string; displayName?: string }): string {
  return account.displayName?.trim() || account.username;
}

/** Storage key of a message: author + message ID is globally unique. */
export function messageKey(authorId: string, messageId: string): string {
  return `${authorId}/${messageId}`;
}
