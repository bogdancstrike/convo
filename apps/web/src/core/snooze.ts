/**
 * Timed conversation snoozing (specs §30.8, FR-NOTIF-01): an overlay on the chat's notification
 * mode. Presets resolve to an exact local time that the UI shows before confirming.
 */

/** Snooze state on a conversation (E2EE, synced to own devices). */
export interface Snooze {
  /** UTC deadline (ms). */
  until: number;
  /** IANA time zone the user chose it in (display only; the deadline never moves on DST/zone change). */
  zone: string;
}

/** "This evening" = 18:00 today if still ahead, otherwise 18:00 tomorrow. */
export function thisEvening(now: Date): Date {
  const at = new Date(now); at.setHours(18, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** "Tomorrow morning" = 09:00 on the next local day. */
export function tomorrowMorning(now: Date): Date {
  const at = new Date(now); at.setDate(at.getDate() + 1); at.setHours(9, 0, 0, 0);
  return at;
}

/** Whether a snooze is currently suppressing alerts. */
export function isSnoozed(snooze: Snooze | undefined, now = Date.now()): boolean {
  return !!snooze && snooze.until > now;
}

/** Local time zone name (falls back to UTC). */
export function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
