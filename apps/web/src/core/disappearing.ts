import type { StoreOp } from '../storage/encryptedStore';
import type { ChatMessage } from './model';

/**
 * Disappearing messages (specs §17).
 *
 * A chat timer is an authenticated E2EE conversation event (`timerUpdate`); every message also
 * carries the sender's timer (`expireTimer`). Own messages expire `timer` after sending; received
 * messages after this account first reads them on this device. Expired messages are removed with
 * the same suppression markers as "delete for me", so archive replays cannot bring them back.
 * Copies saved elsewhere (screenshots, exported files, modified clients) are out of reach.
 */
export const DISAPPEARING_TIMERS = [0, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600] as const;
export type DisappearingTimer = (typeof DISAPPEARING_TIMERS)[number];

/** Index of messages with a deadline so the sweeper never scans every conversation. */
export const EXPIRY_NS = 'expiry-index';
export interface ExpiryEntry { conversationId: string; authorId: string; id: string; expiresAt: number }

export function isTimer(value: unknown): value is DisappearingTimer {
  return DISAPPEARING_TIMERS.includes(value as DisappearingTimer);
}

/** Starts the countdown (idempotent: an existing deadline is kept). */
export function startExpiry(message: ChatMessage, now: number): ChatMessage {
  if (!message.expireTimer || message.expiresAt) return message;
  return { ...message, expiresAt: now + message.expireTimer * 1000 };
}

export function expiryOp(message: ChatMessage): StoreOp | undefined {
  if (!message.expiresAt) return undefined;
  const entry: ExpiryEntry = { conversationId: message.conversationId, authorId: message.authorId, id: message.id, expiresAt: message.expiresAt };
  return { type: 'put', ns: EXPIRY_NS, id: JSON.stringify([entry.conversationId, entry.authorId, entry.id]), value: entry };
}

/** Restored history: drop messages whose deadline already passed. */
export function expired(message: ChatMessage, now: number): boolean {
  return !!message.expiresAt && message.expiresAt <= now;
}
