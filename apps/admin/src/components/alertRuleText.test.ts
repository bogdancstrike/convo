import { describe, expect, it } from 'vitest';
import { ruleSentenceText } from './alertRuleText';

describe('ruleSentenceText', () => {
  it('summarises threshold rules with live values and pluralisation', () => {
    expect(ruleSentenceText({ id: 'failed-logins', severity: 'high', threshold: 5, windowMinutes: 5 })).toBe('Raise a HIGH alert when one person fails to sign in 5 times within 5 minutes.');
    expect(ruleSentenceText({ id: 'device-burst', severity: 'medium', threshold: 1, windowMinutes: 1 })).toBe('Raise a MEDIUM alert when one account enrolls 1 new device within 1 minute.');
  });
  it('omits fixed values for role grants and uses the grace period for audit sync', () => {
    expect(ruleSentenceText({ id: 'role-grant', severity: 'high', threshold: 1, windowMinutes: 1 })).toBe('Raise a HIGH alert every time an administrator grants a privileged Convo role.');
    expect(ruleSentenceText({ id: 'audit-sync', severity: 'critical', threshold: 1, windowMinutes: 2 })).toBe('Raise a CRITICAL alert when identity events have not been imported successfully for 2 minutes.');
  });
});
