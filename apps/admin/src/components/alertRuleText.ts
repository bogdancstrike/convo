import type { AlertRule, BusinessHours } from '../api';

/**
 * How a rule groups audit entries; mirrors `SecurityAlerts.Kind` on the server.
 * - `event`: every matching entry raises its own alert (threshold/window fixed at 1)
 * - `actor`: N matching entries by the same person within the window
 * - `target`: N matching entries for the same account within the window
 * - `offHours`: privileged actions outside business hours, grouped per administrator within the window
 * - `health`: identity audit importer health (window = grace period)
 */
export type RuleKind = 'event' | 'actor' | 'target' | 'offHours' | 'health';
/** Client catalogue of the built-in rules, in display order. Content rules are impossible: messages are end-to-end encrypted. */
export const RULE_CATALOG: { id: string; name: string; kind: RuleKind; group: string }[] = [
  { id: 'failed-logins', name: 'Repeated failed logins', kind: 'actor', group: 'Sign-in and devices' },
  { id: 'device-burst', name: 'Device enrollment burst', kind: 'target', group: 'Sign-in and devices' },
  { id: 'role-grant', name: 'Privileged role granted', kind: 'event', group: 'Administrator activity' },
  { id: 'audit-export', name: 'Audit log exported', kind: 'event', group: 'Administrator activity' },
  { id: 'bulk-device-unlink', name: 'Bulk device unlinking', kind: 'actor', group: 'Administrator activity' },
  { id: 'bulk-account-disable', name: 'Bulk account disabling', kind: 'actor', group: 'Administrator activity' },
  { id: 'credential-reset-burst', name: 'Credential reset burst', kind: 'actor', group: 'Administrator activity' },
  { id: 'session-end-burst', name: 'Session termination burst', kind: 'actor', group: 'Administrator activity' },
  { id: 'off-hours-admin', name: 'Off-hours admin activity', kind: 'offHours', group: 'Administrator activity' },
  { id: 'audit-sync', name: 'Identity audit sync unavailable', kind: 'health', group: 'System health' },
];
export const ruleKind = (id: string): RuleKind => RULE_CATALOG.find((r) => r.id === id)?.kind ?? 'actor';
/** Threshold is editable only for burst rules; the window is fixed only for event rules. */
export const ruleFields = (id: string) => { const kind = ruleKind(id); return { threshold: kind === 'actor' || kind === 'target', window: kind !== 'event', businessHours: kind === 'offHours' }; };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** "07:00–19:00 UTC, Mon–Fri" (consecutive days collapse into ranges). */
export function businessHoursText(hours: BusinessHours): string {
  const days = [...hours.days].sort((a, b) => a - b); const ranges: string[] = [];
  for (let i = 0; i < days.length; i++) {
    let j = i; while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    ranges.push(j - i >= 2 ? `${DAY_NAMES[days[i]! - 1]}–${DAY_NAMES[days[j]! - 1]}` : days.slice(i, j + 1).map((d) => DAY_NAMES[d - 1]).join(', '));
    i = j;
  }
  return `${pad(hours.startHour)}–${pad(hours.endHour)} UTC, ${ranges.join(', ') || 'no days'}`;
}
export { DAY_NAMES };

type SentenceRule = Pick<AlertRule, 'id' | 'severity' | 'threshold' | 'windowMinutes'> & { businessHours?: BusinessHours | null };
/** A run of sentence text, or a value to emphasise. */
export type SentencePart = string | { em: string };
/** Plain-language summary of a rule's current values, split into text and emphasised values. */
export function sentenceParts(rule: SentenceRule): SentencePart[] {
  const head: SentencePart[] = ['Raise a ', { em: rule.severity.toUpperCase() }, ' alert '];
  const window = { em: plural(rule.windowMinutes, 'minute') };
  const n = (one: string, many?: string) => ({ em: plural(rule.threshold, one, many) });
  switch (rule.id) {
    case 'failed-logins': return [...head, 'when one person fails to sign in ', n('time'), ' within ', window, '.'];
    case 'device-burst': return [...head, 'when one account enrolls ', n('new device'), ' within ', window, '.'];
    case 'role-grant': return [...head, { em: 'every time' }, ' an administrator grants a privileged Convo role.'];
    case 'audit-export': return [...head, { em: 'every time' }, ' an administrator exports the audit log.'];
    case 'bulk-device-unlink': return [...head, 'when one administrator unlinks ', n('device'), ' within ', window, '.'];
    case 'bulk-account-disable': return [...head, 'when one administrator disables ', n('account'), ' within ', window, '.'];
    case 'credential-reset-burst': return [...head, 'when one administrator makes ', n('credential reset'), ' (passwords, required actions or recovery kits) within ', window, '.'];
    case 'session-end-burst': return [...head, 'when one administrator ends ', n('session'), ' within ', window, '.'];
    case 'off-hours-admin': return [...head, 'when an administrator makes a privileged change ', { em: 'outside business hours' }, rule.businessHours ? ` (${businessHoursText(rule.businessHours)})` : '', '. Changes within ', window, ' form one alert.'];
    case 'audit-sync': return [...head, 'when identity events have not been imported successfully for ', window, '.'];
    default: return [...head, 'when the rule condition is met.'];
  }
}
/** The same summary as plain text. */
export function ruleSentenceText(rule: SentenceRule): string {
  return sentenceParts(rule).map((part) => typeof part === 'string' ? part : part.em).join('');
}
