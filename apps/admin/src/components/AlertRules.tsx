import { useEffect, useState, type ReactNode } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Segmented, Space, Switch, Tag, Typography } from 'antd';
import { BellOutlined, UndoOutlined } from '@ant-design/icons';
import { api, errorText, type AlertRule, type AlertSeverity } from '../api';
import { fmtTime } from '../format';
import { DAY_NAMES, RULE_CATALOG, ruleKind, sentenceParts } from './alertRuleText';

export const ALERT_RULE_NAMES: Record<string, string> = Object.fromEntries(RULE_CATALOG.map((r) => [r.id, r.name]));
const ORDER = RULE_CATALOG.map((r) => r.id);
/** Rules in a stable, documented order (sign-in and devices, administrator activity, system health) regardless of API order. */
export const sortRules = (rules: AlertRule[]) => [...rules].sort((a, b) => (ORDER.indexOf(a.id) >>> 0) - (ORDER.indexOf(b.id) >>> 0));
/** Severity order used by the editor and the flow; colours are fixed so severity reads the same everywhere. */
export const SEVERITIES: AlertSeverity[] = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_COLORS: Record<AlertSeverity, string> = { critical: '#D14B4B', high: '#E0703A', medium: '#D9922E', low: '#2596BE' };
/** Inclusive limits enforced by the backend (`SecurityAlerts.updateRule`). */
export const RULE_LIMITS = { threshold: [1, 1000], windowMinutes: [1, 1440] } as const;

/** Plain-language summary of a rule's current values, e.g. "Raise a HIGH alert when one person fails to sign in 5 times within 5 minutes." */
export function ruleSentence(rule: Parameters<typeof sentenceParts>[0]): ReactNode {
  return sentenceParts(rule).map((part, i) => typeof part === 'string' ? part : <strong key={i}>{part.em}</strong>);
}
/** Loads the detection rules once per `version`; `setRules` accepts the list returned by a save. */
export function useAlertRules(version: number | string) {
  const [rules, setRules] = useState<AlertRule[] | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setError(null);
    void api.alertRules().then((data) => { if (active) setRules(data); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [version]);
  return { rules, error, setRules };
}

/**
 * Detection rule editor: one card per rule with a plain-language summary of its current settings.
 * Read-only for operators without `ALERT_RULES_MANAGE`; saving requires a reason and is audited.
 */
export function AlertRules({ rules, error, editable, onSaved }: { rules: AlertRule[] | null; error: string | null; editable: boolean; onSaved: (rules: AlertRule[]) => void }) {
  const sorted = sortRules(rules ?? []); const groups = [...new Set(RULE_CATALOG.map((r) => r.group))];
  const groupOf = (id: string) => RULE_CATALOG.find((r) => r.id === id)?.group ?? 'Other';
  return <div className="alert-rules-panel">{error && <Alert type="error" showIcon message={error} />}
    <Alert type="info" showIcon message={editable ? 'Changes apply to newly processed events' : 'You can view detection rules but not change them'}
      description={<>{editable ? 'Existing alerts keep their severity and evidence. Saving requires a reason, which is recorded in the audit log.' : 'Changing rules requires the alert rule management permission.'} Rules use server-visible activity only: messages and attachments are end-to-end encrypted, so content such as file types or links cannot be inspected.</>} />
    {[...groups, 'Other'].map((group) => { const items = sorted.filter((r) => groupOf(r.id) === group); return items.length > 0 && <section key={group} className="alert-rule-group" aria-label={group}>
      <Typography.Title level={5} className="alert-rule-group-title">{group} <Typography.Text type="secondary">· {items.filter((r) => r.enabled).length} of {items.length} on</Typography.Text></Typography.Title>
      <div className="alert-rule-grid">{items.map((rule) => <RuleEditor key={`${rule.id}:${rule.updatedAt}`} rule={rule} editable={editable} onSaved={onSaved} />)}</div>
    </section>; })}
  </div>;
}

/** Audit actors are recorded as "<id> (<username>)"; show the username and keep the full value in a tooltip. */
const actorName = (actor: string) => /^\S+ \((.+)\)$/.exec(actor)?.[1] ?? actor;
type Draft = Pick<AlertRule, 'enabled' | 'severity' | 'threshold' | 'windowMinutes' | 'notificationsEnabled' | 'businessHours'>;
const KEYS = ['enabled', 'severity', 'threshold', 'windowMinutes', 'notificationsEnabled', 'businessHours'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const normalHours = (h: AlertRule['businessHours']) => h && { ...h, days: [...(h.days ?? [])].sort((x, y) => x - y) };
/** What a burst rule counts, as used in its editable condition sentence. */
const COUNTED: Record<string, [string, string]> = {
  'failed-logins': ['failed sign-ins by the same person', 'Failed sign-ins to trigger'], 'device-burst': ['new devices on the same account', 'Device enrollments to trigger'],
  'bulk-device-unlink': ['device unlinks by the same administrator', 'Device unlinks to trigger'], 'bulk-account-disable': ['account disables by the same administrator', 'Account disables to trigger'],
  'credential-reset-burst': ['password resets, required-action changes or recovery-kit revocations by the same administrator', 'Credential resets to trigger'],
  'session-end-burst': ['ended sessions or sign-outs by the same administrator', 'Session terminations to trigger'],
};
const inRange = (value: unknown, [min, max]: readonly [number, number]) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** One rule card. The reason, Reset and Save controls only appear once the draft differs from the saved rule. */
function RuleEditor({ rule, editable, onSaved }: { rule: AlertRule; editable: boolean; onSaved: (rules: AlertRule[]) => void }) {
  const [form] = Form.useForm<Draft & { reason: string }>();
  const [draft, setDraft] = useState<Draft>(rule); const [busy, setBusy] = useState(false); const { message } = App.useApp();
  const name = ALERT_RULE_NAMES[rule.id] ?? rule.id;
  const kind = ruleKind(rule.id); const hours = draft.businessHours;
  const dirty = KEYS.some((key) => key === 'businessHours' ? !same(normalHours(draft.businessHours), normalHours(rule.businessHours)) : draft[key] !== rule[key]);
  const hoursValid = kind !== 'offHours' || (!!hours && inRange(hours.startHour, [0, 23]) && inRange(hours.endHour, [1, 24]) && hours.startHour < hours.endHour && hours.days?.length > 0);
  const valid = inRange(draft.threshold, RULE_LIMITS.threshold) && inRange(draft.windowMinutes, RULE_LIMITS.windowMinutes) && hoursValid;
  const reset = () => { form.resetFields(); setDraft(rule); };
  const number = (field: 'threshold' | 'windowMinutes', label: string) => <Form.Item name={field} noStyle><InputNumber className="rule-inline-number" size="small" min={RULE_LIMITS[field][0]} max={RULE_LIMITS[field][1]} precision={0} aria-label={label} status={inRange(draft[field], RULE_LIMITS[field]) ? undefined : 'error'} /></Form.Item>;
  const condition = COUNTED[rule.id] ? <>Trigger after {number('threshold', COUNTED[rule.id]![1])} {COUNTED[rule.id]![0]} within {number('windowMinutes', 'Window in minutes')} minutes</>
    : kind === 'health' ? <>Trigger when no successful import has happened for {number('windowMinutes', 'Grace period in minutes')} minutes</>
    : kind === 'offHours' ? <>Changes by one administrator within {number('windowMinutes', 'Grouping window in minutes')} minutes form one alert</>
    : <>{rule.id === 'audit-export' ? 'Every export' : 'Every grant'} raises its own alert. The threshold is fixed.</>;
  const hour = (field: 'startHour' | 'endHour', label: string, range: [number, number]) => <Form.Item name={['businessHours', field]} noStyle><InputNumber className="rule-inline-number rule-hour-number" size="small" min={range[0]} max={range[1]} precision={0} aria-label={label} status={hoursValid ? undefined : 'error'} /></Form.Item>;
  return <Card className={`alert-rule-card${draft.enabled ? '' : ' alert-rule-off'}`} data-testid={`alert-rule-${rule.id}`} title={<Space size={8} wrap><span>{name}</span>{dirty && <Tag color="processing">Unsaved changes</Tag>}</Space>}
    extra={<Space size={8}><Typography.Text type={draft.enabled ? 'success' : 'secondary'}>{draft.enabled ? 'On' : 'Off'}</Typography.Text><Switch checked={draft.enabled} disabled={!editable || busy} aria-label={`Enable ${name}`} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} /></Space>}>
    <Form form={form} name={`alert-rule-${rule.id}`} layout="vertical" initialValues={{ ...rule, reason: '' }} disabled={!editable || busy}
      onValuesChange={(_, values) => setDraft((d) => ({ ...d, ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'reason')) }))}
      onFinish={async ({ reason }) => {
        if (!valid) return;
        setBusy(true); try { onSaved(await api.updateAlertRule({ ...rule, ...draft, businessHours: normalHours(draft.businessHours) }, reason)); message.success('Alert rule updated'); } catch (e) { message.error(errorText(e)); } finally { setBusy(false); }
      }}>
      <p className="rule-sentence" data-testid={`alert-rule-summary-${rule.id}`}>{draft.enabled ? ruleSentence({ ...rule, ...draft }) : <><strong>Off.</strong> New events are not checked and existing alerts stay in the inbox. When on: {ruleSentence({ ...rule, ...draft })}</>}</p>
      <div className="rule-setting"><span className="rule-setting-label">Severity</span><Form.Item name="severity" noStyle><Segmented className="rule-severity" size="small" disabled={!editable || busy} aria-label={`Severity for ${name}`}
        options={SEVERITIES.map((value) => ({ value, label: <span className="rule-severity-option" style={{ ['--severity' as string]: SEVERITY_COLORS[value] }}><i aria-hidden="true" />{value[0]!.toUpperCase() + value.slice(1)}</span> }))} /></Form.Item></div>
      {kind === 'offHours' && <div className="rule-setting"><span className="rule-setting-label">Hours</span><span className="rule-condition">Business hours {hour('startHour', 'Business hours start (UTC hour)', [0, 23])}:00 – {hour('endHour', 'Business hours end (UTC hour)', [1, 24])}:00 UTC
        <Form.Item name={['businessHours', 'days']} noStyle><Checkbox.Group className="rule-days" aria-label="Business days" options={DAY_NAMES.map((label, i) => ({ label, value: i + 1 }))} /></Form.Item></span></div>}
      <div className="rule-setting"><span className="rule-setting-label">When</span><span className="rule-condition">{condition}</span></div>
      {!valid && <Typography.Text type="danger" className="rule-invalid">{hoursValid ? <>Use whole numbers: events {RULE_LIMITS.threshold[0]}–{RULE_LIMITS.threshold[1]}, minutes {RULE_LIMITS.windowMinutes[0]}–{RULE_LIMITS.windowMinutes[1]}.</> : <>Business hours need a start before the end (0–24 UTC) and at least one day.</>}</Typography.Text>}
      <div className="rule-setting"><span className="rule-setting-label"><BellOutlined /> Notify</span><Space size={8}><Form.Item name="notificationsEnabled" valuePropName="checked" noStyle><Switch size="small" aria-label={`Notify for ${name}`} /></Form.Item>
        <Typography.Text type="secondary">{draft.notificationsEnabled ? 'In-app count and opted-in desktop notifications' : 'Inbox only, no notifications'}</Typography.Text></Space></div>
      {editable && dirty && <div className="rule-save">
        <Form.Item name="reason" label="Reason for this change" rules={[{ required: true, whitespace: true, message: 'Record a reason for the audit log.' }]}><Input.TextArea rows={2} maxLength={500} placeholder="Reason recorded in the audit log" /></Form.Item>
        <Space><Button icon={<UndoOutlined />} onClick={reset} disabled={busy}>Reset</Button><Button type="primary" htmlType="submit" loading={busy} disabled={!valid}>Save rule</Button></Space>
      </div>}
    </Form>
    <Typography.Paragraph className="rule-updated" type="secondary">Last changed {fmtTime(rule.updatedAt)} by <span title={rule.updatedBy}>{actorName(rule.updatedBy)}</span></Typography.Paragraph>
  </Card>;
}
