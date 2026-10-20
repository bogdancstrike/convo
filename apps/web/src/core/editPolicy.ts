import { MAX_BODY_BYTES } from '../crypto/content';
import type { ChatMessage, Conversation } from './model';

/**
 * Message edit policy (specs §25.1).
 *
 * The server advertises the windows in `/v1/deployment-info`; it never sees plaintext, so every
 * receiving client enforces them. Times are measured with **server** timestamps: the envelope that
 * carried the original message versus the envelope that carried the edit. Sender clocks only
 * decide whether the Edit action is offered.
 *
 * Rules: only the author's own text (or caption) is editable, media never changes, edits must
 * change the text, and each edit carries a strictly increasing revision so that late or replayed
 * edits cannot roll content back.
 */
export interface EditPolicy {
  /** Direct chats, groups and Note to self. */
  windowMs: number;
  /** Channel (admin-only group) posts. */
  channelWindowMs: number;
  /** Tolerance for edits queued inside the window and accepted shortly after it closed. */
  graceMs: number;
}

export const DEFAULT_EDIT_POLICY: Readonly<EditPolicy> = Object.freeze({
  windowMs: 15 * 60_000,
  channelWindowMs: 30 * 24 * 3600_000,
  graceMs: 5 * 60_000,
});

let current: EditPolicy = { ...DEFAULT_EDIT_POLICY };

/** Applies the deployment policy; invalid values keep the defaults. */
export function configureEditPolicy(limits: { editWindowMs?: number; channelEditWindowMs?: number; editGraceMs?: number } | undefined): void {
  const positive = (value: number | undefined, fallback: number) => (Number.isFinite(value) && value! > 0 ? value! : fallback);
  current = {
    windowMs: positive(limits?.editWindowMs, DEFAULT_EDIT_POLICY.windowMs),
    channelWindowMs: positive(limits?.channelEditWindowMs, DEFAULT_EDIT_POLICY.channelWindowMs),
    graceMs: Number.isFinite(limits?.editGraceMs) && limits!.editGraceMs! >= 0 ? limits!.editGraceMs! : DEFAULT_EDIT_POLICY.graceMs,
  };
}

export function editPolicy(): Readonly<EditPolicy> { return current; }

/** Edit window for a conversation: channels allow longer post corrections. */
export function editWindowFor(conversation: Pick<Conversation, 'kind' | 'adminOnly'> | undefined): number {
  return conversation?.kind === 'group' && conversation.adminOnly ? current.channelWindowMs : current.windowMs;
}

/** Server time the original message arrived; legacy records fall back to the best local value. */
export function editAnchor(message: ChatMessage): number {
  return message.serverAt ?? (message.direction === 'in' ? message.sort : message.sentAt);
}

/** True when the message has editable text: own text/caption, not deleted or unreadable. */
export function hasEditableText(message: ChatMessage): boolean {
  return message.body !== undefined && !message.deleted && !message.unsupported && !message.undecryptable;
}

/**
 * When the author may no longer edit, or `undefined` if the message cannot be edited at all.
 * Used by both the web UI and the native bridge.
 */
export function editableUntil(message: ChatMessage, conversation: Pick<Conversation, 'kind' | 'adminOnly'> | undefined, selfAccountId: string): number | undefined {
  if (message.authorId !== selfAccountId || !hasEditableText(message)) return undefined;
  return editAnchor(message) + editWindowFor(conversation);
}

export function canEdit(message: ChatMessage, conversation: Pick<Conversation, 'kind' | 'adminOnly'> | undefined, selfAccountId: string, now = Date.now()): boolean {
  const until = editableUntil(message, conversation, selfAccountId);
  return until !== undefined && now < until;
}

/** Validates replacement text; returns the normalized body or `undefined` when it must be rejected. */
export function normalizeEditBody(target: ChatMessage, body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  const text = body.trim();
  if (!text || text === target.body || new TextEncoder().encode(text).length > MAX_BODY_BYTES) return undefined;
  return text;
}

/** Revision ordering; legacy edits without a revision are ordered by their timestamp. */
export function isNewerRevision(target: ChatMessage, revision: number | undefined, editedAt: number): boolean {
  if (revision !== undefined) return revision > (target.revision ?? 0);
  return target.revision === undefined && editedAt > (target.editedAt ?? 0);
}

/**
 * Receiver-side acceptance of an edit that arrived in an envelope accepted by the server at
 * `editServerAt`. The author check is done by the caller (edits are looked up by author).
 */
export function acceptsEdit(target: ChatMessage, conversation: Pick<Conversation, 'kind' | 'adminOnly'> | undefined,
  body: unknown, revision: number | undefined, editedAt: number, editServerAt: number): string | undefined {
  if (!hasEditableText(target)) return undefined;
  if (editServerAt - editAnchor(target) > editWindowFor(conversation) + current.graceMs) return undefined;
  if (!isNewerRevision(target, revision, editedAt)) return undefined;
  return normalizeEditBody(target, body);
}
