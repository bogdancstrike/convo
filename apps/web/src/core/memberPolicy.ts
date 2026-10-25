/**
 * Member restrictions for groups (specs §30.4 "per-member send restrictions, slow mode"): owners and
 * admins set a slow-mode interval and a list of members who may read but not post. The policy is a
 * revisioned E2EE group event (highest revision wins; equal revisions keep the current value), so
 * every member converges on it. The sender's client refuses restricted sends, and receivers drop
 * messages that break the policy, so a modified client cannot bypass it for honest members.
 * Owners and admins are never restricted.
 */
export interface MemberPolicy { slowModeSeconds: number; restricted: string[]; revision: number }

/** Slow-mode intervals offered in the UI (seconds; 0 = off). */
export const SLOW_MODE_STEPS = [0, 10, 30, 60, 300, 900, 3600] as const;
export const MAX_SLOW_MODE_SECONDS = 86_400;
export const MAX_RESTRICTED = 1000;
/** Receivers accept a post this much earlier than the interval (clock and delivery jitter). */
export const SLOW_MODE_TOLERANCE_MS = 2_000;

export function applyPolicy(current: MemberPolicy | undefined, next: MemberPolicy): MemberPolicy | undefined {
  if (current && current.revision >= next.revision) return current;
  return { slowModeSeconds: Math.min(MAX_SLOW_MODE_SECONDS, Math.max(0, Math.floor(next.slowModeSeconds))), restricted: [...new Set(next.restricted)].slice(0, MAX_RESTRICTED), revision: next.revision };
}

export type PostDecision = { ok: true } | { ok: false; reason: 'restricted' } | { ok: false; reason: 'slow'; retryAt: number };

/**
 * Whether `accountId` may post now. `lastPostAt` is when that member's previous accepted post was
 * sent (sender side) or received by the server (receiver side).
 */
export function mayPost(policy: MemberPolicy | undefined, accountId: string, isAdmin: boolean, lastPostAt: number | undefined, now: number, toleranceMs = 0): PostDecision {
  if (!policy || isAdmin) return { ok: true };
  if (policy.restricted.includes(accountId)) return { ok: false, reason: 'restricted' };
  if (policy.slowModeSeconds > 0 && lastPostAt !== undefined) {
    const retryAt = lastPostAt + policy.slowModeSeconds * 1000;
    if (now + toleranceMs < retryAt) return { ok: false, reason: 'slow', retryAt };
  }
  return { ok: true };
}
