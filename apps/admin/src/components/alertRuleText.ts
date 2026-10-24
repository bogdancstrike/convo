import type { AlertRule } from '../api';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A run of sentence text, or a value to emphasise. */
export type SentencePart = string | { em: string };
/** Plain-language summary of a rule's current values, split into text and emphasised values. */
export function sentenceParts(rule: Pick<AlertRule, 'id' | 'severity' | 'threshold' | 'windowMinutes'>): SentencePart[] {
  const head: SentencePart[] = ['Raise a ', { em: rule.severity.toUpperCase() }, ' alert '];
  const window = { em: plural(rule.windowMinutes, 'minute') };
  switch (rule.id) {
    case 'failed-logins': return [...head, 'when one person fails to sign in ', { em: plural(rule.threshold, 'time') }, ' within ', window, '.'];
    case 'device-burst': return [...head, 'when one account enrolls ', { em: plural(rule.threshold, 'new device') }, ' within ', window, '.'];
    case 'role-grant': return [...head, { em: 'every time' }, ' an administrator grants a privileged Convo role.'];
    case 'audit-sync': return [...head, 'when identity events have not been imported successfully for ', window, '.'];
    default: return [...head, 'when the rule condition is met.'];
  }
}
/** The same summary as plain text. */
export function ruleSentenceText(rule: Pick<AlertRule, 'id' | 'severity' | 'threshold' | 'windowMinutes'>): string {
  return sentenceParts(rule).map((part) => typeof part === 'string' ? part : part.em).join('');
}

