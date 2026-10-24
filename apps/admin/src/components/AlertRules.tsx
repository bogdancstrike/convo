import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Switch, Typography } from 'antd';
import { api, errorText, type AlertRule } from '../api';
import { fmtTime } from '../format';

export const ALERT_RULE_NAMES: Record<string, string> = { 'failed-logins': 'Repeated failed logins', 'device-burst': 'Device enrollment burst', 'role-grant': 'Privileged role granted', 'audit-sync': 'Identity audit sync unavailable' };
const RULE_DESCRIPTIONS: Record<string, string> = {
  'failed-logins': 'Detect repeated unsuccessful sign-ins for the same identity within a rolling time window.',
  'device-burst': 'Detect several new messaging devices enrolled for the same account in a short period.',
  'role-grant': 'Create an alert whenever an administrator grants a privileged Convo role.',
  'audit-sync': 'Raise an alert when identity events cannot be synchronized within the configured grace period.',
};
export function AlertRules({ editable, onChanged }: { editable: boolean; onChanged: () => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void api.alertRules().then((data) => { if (active) setRules(data); }).catch((e) => { if (active) setError(errorText(e)); }); return () => { active = false; }; }, []);
  return <div className="alert-rules-panel">{error && <Alert type="error" showIcon message={error} />}
    <Alert type="info" showIcon message="Rules apply to newly processed events" description="Changing a rule preserves existing alerts and their severity. Notification rules control in-app notification counts and optional desktop notifications. Resolved alerts and evidence remain available." />
    <div className="alert-rule-grid">{rules.map((rule) => <RuleEditor key={`${rule.id}:${rule.updatedAt}`} rule={rule} editable={editable} onSaved={(updated) => { setRules(updated); onChanged(); }} />)}</div>
  </div>;
}
function RuleEditor({ rule, editable, onSaved }: { rule: AlertRule; editable: boolean; onSaved: (rules: AlertRule[]) => void }) {
  const [busy, setBusy] = useState(false); const { message } = App.useApp();
  const threshold = rule.id === 'failed-logins' || rule.id === 'device-burst';
  return <Card title={ALERT_RULE_NAMES[rule.id]} className="alert-rule-card" data-testid={`alert-rule-${rule.id}`} extra={<Typography.Text type={rule.enabled ? 'success' : 'secondary'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Typography.Text>}>
    <Typography.Paragraph type="secondary">{RULE_DESCRIPTIONS[rule.id]}</Typography.Paragraph>
    <Form name={`alert-rule-${rule.id}`} layout="vertical" initialValues={{ ...rule, reason: '' }} disabled={!editable || busy} onFinish={async (values: AlertRule & { reason: string }) => {
      setBusy(true); try { onSaved(await api.updateAlertRule({ ...rule, ...values }, values.reason)); message.success('Alert rule updated'); } catch (e) { message.error(errorText(e)); } finally { setBusy(false); }
    }}>
      <div className="alert-rule-fields"><Form.Item name="enabled" label="Detection" valuePropName="checked"><Switch aria-label={`Enable ${ALERT_RULE_NAMES[rule.id]}`} /></Form.Item><Form.Item name="notificationsEnabled" label="Notifications" valuePropName="checked"><Switch aria-label={`Notify for ${ALERT_RULE_NAMES[rule.id]}`} /></Form.Item>
      <Form.Item name="severity" label="Severity"><Select options={['critical', 'high', 'medium', 'low'].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} /></Form.Item>
      {threshold && <Form.Item name="threshold" label="Events to trigger" rules={[{ required: true }]}><InputNumber min={1} max={1000} precision={0} /></Form.Item>}
      {rule.id !== 'role-grant' && <Form.Item name="windowMinutes" label={rule.id === 'audit-sync' ? 'Grace period (minutes)' : 'Window (minutes)'} rules={[{ required: true }]}><InputNumber min={1} max={1440} precision={0} /></Form.Item>}</div>
      {editable && <><Form.Item name="reason" label="Reason for this change" rules={[{ required: true, whitespace: true, message: 'Record a reason for the audit log.' }]}><Input.TextArea rows={2} maxLength={500} placeholder="Reason recorded in the audit log" /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>Save rule</Button></>}
    </Form><Typography.Paragraph className="rule-updated" type="secondary">Updated {fmtTime(rule.updatedAt)} · {rule.updatedBy}</Typography.Paragraph>
  </Card>;
}
