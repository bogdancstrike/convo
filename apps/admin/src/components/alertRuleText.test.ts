import { describe, expect, it } from 'vitest';
import { businessHoursText, RULE_CATALOG, ruleFields, ruleSentenceText } from './alertRuleText';

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

describe('new admin-activity rules', () => {
  it('describes actor bursts, audit exports and off-hours activity', () => {
    expect(ruleSentenceText({ id: 'bulk-device-unlink', severity: 'high', threshold: 5, windowMinutes: 10 })).toBe('Raise a HIGH alert when one administrator unlinks 5 devices within 10 minutes.');
    expect(ruleSentenceText({ id: 'audit-export', severity: 'medium', threshold: 1, windowMinutes: 1 })).toBe('Raise a MEDIUM alert every time an administrator exports the audit log.');
    expect(ruleSentenceText({ id: 'off-hours-admin', severity: 'medium', threshold: 1, windowMinutes: 60, businessHours: { startHour: 7, endHour: 19, days: [1, 2, 3, 4, 5] } }))
      .toBe('Raise a MEDIUM alert when an administrator makes a privileged change outside business hours (07:00–19:00 UTC, Mon–Fri). Changes within 60 minutes form one alert.');
  });
  it('collapses consecutive business days and lists the rest', () => {
    expect(businessHoursText({ startHour: 0, endHour: 24, days: [7, 1, 2, 3, 6] })).toBe('00:00–24:00 UTC, Mon–Wed, Sat, Sun');
    expect(businessHoursText({ startHour: 9, endHour: 17, days: [1, 3] })).toBe('09:00–17:00 UTC, Mon, Wed');
  });
  it('exposes only meaningful fields per rule kind', () => {
    expect(ruleFields('audit-export')).toEqual({ threshold: false, window: false, businessHours: false });
    expect(ruleFields('off-hours-admin')).toEqual({ threshold: false, window: true, businessHours: true });
    expect(ruleFields('session-end-burst')).toEqual({ threshold: true, window: true, businessHours: false });
    expect(RULE_CATALOG).toHaveLength(10);
  });
});
