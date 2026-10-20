import type { CallMessage } from '../crypto/content';

/**
 * Call domain types shared by the web UI and the Android bridge.
 *
 * Media goes through the self-hosted LiveKit SFU; Convo's server only authorizes rooms. Ringing
 * and call events travel as E2EE `call` messages, and the ring carries a fresh random media key
 * for LiveKit's end-to-end frame encryption.
 */

/** A ring older than this (by server time) is shown as a missed call, never as ringing. */
export const RING_TIMEOUT_MS = 45_000;

export interface CallInvite {
  callId: string;
  conversationId: string;
  /** Caller account. */
  from: string;
  video: boolean;
  /** base64url media key from the E2EE ring. */
  key: string;
  /** Server time the ring was accepted. */
  at: number;
  group: boolean;
}

/** Credentials to join one LiveKit room (from `/v1/calls`). */
export interface CallJoin {
  callId: string;
  room: string;
  token: string;
  /** Same-origin path proxied to LiveKit (e.g. `/rtc`). */
  path: string;
  video: boolean;
}

export type CallStatus = 'ringing' | 'missed' | 'declined' | 'answered' | 'cancelled' | 'busy' | 'ended';

/** Local call history entry (device-local encrypted store, never uploaded). */
export interface CallLogEntry {
  callId: string;
  conversationId: string;
  direction: 'in' | 'out';
  /** Other party for direct calls / caller for group calls. */
  peer: string;
  video: boolean;
  startedAt: number;
  answeredAt?: number;
  endedAt?: number;
  status: CallStatus;
}

/** Events the UI reacts to. */
export type CallEvent =
  | { type: 'incoming'; invite: CallInvite }
  | { type: 'remote'; callId: string; conversationId: string; from: string; action: CallMessage['action']; fromSelf: boolean };

/** Next history status for an event (history never moves back from a final state). */
export function nextStatus(current: CallStatus, action: CallMessage['action'], fromSelf: boolean, direction: 'in' | 'out'): CallStatus {
  if (current !== 'ringing' && current !== 'answered') return current;
  switch (action) {
    case 'accept': return 'answered';
    case 'decline': return current === 'answered' ? current : direction === 'in' && !fromSelf ? 'cancelled' : 'declined';
    case 'busy': return current === 'answered' ? current : 'busy';
    case 'cancel': return current === 'answered' ? 'ended' : direction === 'in' ? 'missed' : 'cancelled';
    case 'end': return current === 'answered' ? 'ended' : direction === 'in' ? 'missed' : 'cancelled';
    default: return current;
  }
}

/** Fresh 256-bit media key (base64url, 43 chars). */
export function newMediaKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
