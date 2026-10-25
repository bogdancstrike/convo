import { EVENT_MAX_DESCRIPTION, EVENT_MAX_LOCATION, EVENT_MAX_TITLE, type EventDefinition, type RsvpResponse } from '../crypto/content';

/**
 * Events with RSVP (FR-EXT-01, specs §30.4): an encrypted event message with a revision counter,
 * creator/admin updates and cancellation, and one current Going/Maybe/Not going answer per account.
 *
 * Like polls, everything travels as E2EE data messages and every device applies the same rules,
 * so members converge regardless of delivery order: the highest revision wins (ties keep the
 * first seen), the newest answer per account wins (timestamp, then message ID), and answers sent
 * after a cancellation or after the event ended are closed out.
 */
export interface Rsvp { response: RsvpResponse; at: number; id: string }
export interface EventState extends EventDefinition {
  revision: number;
  cancelled?: { at: number };
  rsvps: Record<string, Rsvp>;
}

/** Validated definition from user input. */
export function newEvent(input: { title: string; description?: string; start: number; end?: number; zone?: string; location?: string }): EventDefinition {
  const title = input.title.trim();
  const description = input.description?.trim() || undefined;
  const location = input.location?.trim() || undefined;
  if (!title || title.length > EVENT_MAX_TITLE) throw new Error('event title missing or too long');
  if ((description?.length ?? 0) > EVENT_MAX_DESCRIPTION || (location?.length ?? 0) > EVENT_MAX_LOCATION) throw new Error('event text too long');
  if (!Number.isSafeInteger(input.start) || input.start <= 0) throw new Error('event start missing');
  if (input.end !== undefined && input.end <= input.start) throw new Error('event must end after it starts');
  // Unset fields are omitted (not `undefined`) so the encrypted wire form stays canonical.
  return { title, start: input.start, zone: input.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    ...(description ? { description } : {}), ...(input.end !== undefined ? { end: input.end } : {}), ...(location ? { location } : {}) };
}

export function initialEvent(event: EventDefinition): EventState { return { ...event, revision: 0, rsvps: {} }; }

/** When responses close: cancellation, or the end (or start when no end is given). */
export function closesAt(state: EventState): number { return Math.min(state.cancelled?.at ?? Infinity, state.end ?? state.start); }

/** A newer revision replaces the details (and may cancel); stale revisions are ignored. */
export function applyUpdate(state: EventState, revision: number, event: EventDefinition, cancelled: boolean, at: number): EventState {
  if (revision <= state.revision) return state;
  return { ...state, ...event, revision, cancelled: cancelled ? { at } : undefined };
}

/** The newest answer per account wins; answers after responses closed are ignored. */
export function applyRsvp(state: EventState, account: string, response: RsvpResponse, at: number, id: string): EventState {
  if (at > closesAt(state)) return state;
  const current = state.rsvps[account];
  if (current && (current.at > at || (current.at === at && current.id >= id))) return state;
  return { ...state, rsvps: { ...state.rsvps, [account]: { response, at, id } } };
}

/** Accounts per answer. */
export function responses(state: EventState): Record<RsvpResponse, string[]> {
  const out: Record<RsvpResponse, string[]> = { going: [], maybe: [], no: [] };
  for (const [account, r] of Object.entries(state.rsvps)) out[r.response].push(account);
  return out;
}

/** An iCalendar file for "Add to calendar" (RFC 5545, UTC times; no Convo identifiers inside). */
export function toIcs(state: EventState, uid: string): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Convo//Events//EN', 'BEGIN:VEVENT', `UID:${uid}@convo`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(state.start)}`, `DTEND:${stamp(state.end ?? state.start + 3600_000)}`, `SUMMARY:${text(state.title)}`,
    ...(state.description ? [`DESCRIPTION:${text(state.description)}`] : []), ...(state.location ? [`LOCATION:${text(state.location)}`] : []),
    ...(state.cancelled ? ['STATUS:CANCELLED'] : []), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

/** Lead times offered for local event reminders (minutes before start; 0 = off). */
export const REMINDER_LEADS = [0, 5, 15, 30, 60] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

/**
 * When this device should remind `account` of an event, or undefined for no reminder: only for
 * Going/Maybe answers on events that are not cancelled and have not started. Reminders are
 * device-local; nothing about them leaves the device.
 */
export function reminderAt(state: EventState, account: string, leadMinutes: number, now = Date.now()): number | undefined {
  const answer = state.rsvps[account]?.response;
  if (!leadMinutes || state.cancelled || state.start <= now || (answer !== 'going' && answer !== 'maybe')) return undefined;
  return state.start - leadMinutes * 60_000;
}
