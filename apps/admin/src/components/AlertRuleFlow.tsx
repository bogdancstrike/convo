import { Alert, Button, Descriptions, Empty, Modal, Select, Space, Spin, Typography } from 'antd';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AlertRule } from '../api';
import { STATUS } from '../theme';
import { DiagramView } from './DiagramView';
import { ALERT_RULE_NAMES, SEVERITY_COLORS, ruleSentence, sortRules } from './AlertRules';

import { useDark } from './useDark';
import { businessHoursText, ruleKind } from './alertRuleText';

/** One card in the flow, with the explanation shown when it is selected. */
interface Step { id: string; title: string; subtitle: string; color: string; description: string; facts: [string, string][]; muted?: boolean }

const COLUMN = 320; const ROW = 140; const WIDTH = 270; const HEIGHT = 112;
const SOURCE = '#2596BE'; const CONDITION = '#8075c6'; const MUTED = '#8a99a6';
/** Short noun phrase for what each burst rule counts. */
const COUNTED: Record<string, string> = { 'failed-logins': 'failed sign-ins', 'device-burst': 'device enrollments', 'bulk-device-unlink': 'device unlinks', 'bulk-account-disable': 'account disables', 'credential-reset-burst': 'credential resets', 'session-end-burst': 'ended sessions' };
const minutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const SOURCES: Record<string, { subtitle: string; description: string; facts: [string, string][] }> = {
  'failed-logins': { subtitle: 'Keycloak sign-in failures imported into the audit log',
    description: 'The identity audit importer copies failed sign-ins (auth.login.failed) from Keycloak’s stored user events into the hash-chained audit log. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'auth.login.failed'], ['Counted per', 'Recorded sign-in identity; unknown people keep the attempted username when available'], ['Depends on', 'Keycloak event storage and a healthy identity audit importer']] },
  'device-burst': { subtitle: 'Device enrollment events in the audit log',
    description: 'Every new messaging device linked to a Convo account writes a device.add entry to the audit log immediately. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'device.add'], ['Counted per', 'Convo account'], ['Timing', 'Recorded immediately by the messaging server']] },
  'role-grant': { subtitle: 'Privileged roles granted through the admin console',
    description: 'Granting a Convo administrator role through the admin API writes a role.grant entry to the audit log. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'role.grant'], ['Counted per', 'Each individual grant'], ['Not covered', 'Roles changed directly in Keycloak are outside this rule']] },
  'audit-sync': { subtitle: 'Health of the identity audit importer',
    description: 'Every detection pass checks when the identity audit importer last copied Keycloak events successfully. This rule does not depend on new audit entries arriving.',
    facts: [['Signal', 'Time of the last successful identity import (or backend startup)'], ['Also fails when', 'The importer is not configured or reports an error'], ['Why it matters', 'Without imports, failed sign-ins cannot be detected']] },
  'audit-export': { subtitle: 'Audit log exports by administrators',
    description: 'Exporting the audit log writes an audit.export entry with the administrator and reason. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'audit.export'], ['Counted per', 'Each export'], ['Why it matters', 'An export copies identities and administrative history out of the console']] },
  'bulk-device-unlink': { subtitle: 'Devices unlinked by administrators',
    description: 'Unlinking a person’s messaging device from the console writes a device.revoke entry naming the administrator. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'device.revoke'], ['Counted per', 'Administrator performing the unlink'], ['Not counted', 'People removing or signing out their own devices']] },
  'bulk-account-disable': { subtitle: 'Convo accounts disabled by administrators',
    description: 'Disabling a Convo account from the console writes an account.disable entry naming the administrator. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit action', 'account.disable'], ['Counted per', 'Administrator performing the change']] },
  'credential-reset-burst': { subtitle: 'Password resets, required actions and recovery-kit revocations',
    description: 'Resetting a password, requiring sign-in actions or revoking a recovery kit from the console writes an audit entry naming the administrator. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit actions', 'user.password-reset, user.require-actions, recovery.revoke'], ['Counted per', 'Administrator performing the changes']] },
  'session-end-burst': { subtitle: 'Sessions ended and people signed out by administrators',
    description: 'Ending one live session or signing a person out everywhere writes an audit entry naming the administrator. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit actions', 'session.end, user.sign-out'], ['Counted per', 'Administrator performing the changes']] },
  'off-hours-admin': { subtitle: 'Every privileged administrator change',
    description: 'Account, device, credential, session, role, audit-export and rule changes made through the console are all audited with the administrator and time. Detection reads new audit entries in order, every 15 seconds.',
    facts: [['Audit actions', 'account.*, device.revoke, user.*, role.*, recovery.revoke, session.end, audit.export, push.redrive, alert.rule-update'], ['Counted per', 'Administrator'], ['Time zone', 'Business hours are evaluated in UTC']] },
};

/** Steps 1–5 for one enabled rule, filled in with the rule's live settings. */
function ruleSteps(rule: AlertRule): Step[] {
  const name = ALERT_RULE_NAMES[rule.id] ?? rule.id; const sev = rule.severity.toUpperCase(); const window = minutes(rule.windowMinutes);
  const source = SOURCES[rule.id] ?? { subtitle: 'Audit events', description: 'New audit entries are evaluated in order.', facts: [] };
  const kind = ruleKind(rule.id); const per = rule.id === 'failed-logins' ? 'person' : kind === 'target' ? 'account' : 'administrator';
  const counted = COUNTED[rule.id] ?? 'matching events';
  const condition: Step = kind === 'event'
    ? { id: 'condition', title: `2 · Every ${rule.id === 'audit-export' ? 'export' : 'grant'} counts`, subtitle: 'No threshold or time window', color: CONDITION, description: `Each ${rule.id === 'audit-export' ? 'audit export' : 'privileged role grant'} is significant on its own, so the rule triggers every time. Its threshold and window are fixed at 1.`, facts: [['Threshold', '1 (fixed)'], ['Window', 'Not used']] }
    : kind === 'health'
      ? { id: 'condition', title: `2 · No successful sync in ${window}`, subtitle: 'Grace period after the last good import', color: CONDITION, description: `The rule triggers when the importer has not completed a successful import for ${window}, measured from the last success or from backend startup.`, facts: [['Grace period', window], ['Recovery', 'A successful import ends the outage episode']] }
      : kind === 'offHours'
        ? { id: 'condition', title: '2 · Outside business hours', subtitle: rule.businessHours ? `Business hours: ${businessHoursText(rule.businessHours)}` : 'Business hours not configured', color: CONDITION,
          description: 'Each privileged change is checked against the configured business hours in UTC. A change on a non-business day, before the start hour or from the end hour onwards triggers the rule.',
          facts: [['Business hours', rule.businessHours ? businessHoursText(rule.businessHours) : 'Not configured'], ['Threshold', '1 change (fixed)']] }
        : { id: 'condition', title: `2 · ${rule.threshold} ${counted} in ${window}`, subtitle: `Rolling window per ${per}, checked at each event`, color: CONDITION,
          description: `At each new event the detector counts matching events by the same ${per} in the preceding ${window}. When the count reaches ${rule.threshold}, the rule triggers.`,
          facts: [['Threshold', `${rule.threshold} events (allowed 1–1000)`], ['Window', `${window} (allowed 1–1440)`], ['Boundaries', 'The event time is included; the exact lower boundary is excluded']] };
  const episode: Step = kind === 'event'
    ? { id: 'episode', title: `4 · One alert per ${rule.id === 'audit-export' ? 'export' : 'grant'}`, subtitle: 'Events are never merged', color: SOURCE, description: 'Every matching event creates its own alert so each one is reviewed separately.', facts: [['Deduplication', 'By audit entry, so retries never create duplicates']] }
    : kind === 'health'
      ? { id: 'episode', title: '4 · One alert per outage', subtitle: 'Recovery does not resolve it for you', color: SOURCE, description: 'While the outage continues, the same alert is updated. When imports recover, the outage marker is cleared but the alert stays open for review. A later outage raises a new alert.', facts: [['While failing', 'The existing alert is updated'], ['After recovery', 'The alert remains until an operator resolves it']] }
      : { id: 'episode', title: '4 · Extend the open alert', subtitle: `More events within ${window} update the same alert`, color: SOURCE,
        description: `While an unresolved alert for the same ${per} exists whose latest event is within the last ${window}, new matching events extend its event count and evidence times instead of creating another alert.`,
        facts: [['New alert when', `The alert is resolved, or events pause for longer than ${window}`], ['Acknowledged alerts', 'Stay acknowledged while they are extended']] };
  const steps: Step[] = [
    { id: 'source', title: '1 · Event source', subtitle: source.subtitle, color: SOURCE, description: source.description, facts: source.facts },
    condition,
    { id: 'alert', title: `3 · Raise a ${sev} alert`, subtitle: `“${name}” appears in the inbox`, color: SEVERITY_COLORS[rule.severity],
      description: 'The alert is stored with links to its audit evidence (first and latest event) and an initial history entry. Alerts are signals to investigate; they never block people or end sessions automatically.',
      facts: [['Severity', sev], ['Changing severity later', 'Applies to new alerts; existing alerts keep their severity'], ['Evidence', 'First and latest event times and audit sequence numbers']] },
    episode,
    rule.notificationsEnabled
      ? { id: 'notify', title: '5 · Notify operators', subtitle: 'Sidebar count · desktop alert if opted in', color: STATUS.success,
        description: 'Open alerts from this rule count towards the in-app notification badge. Administrators who enabled desktop alerts in this browser also get a desktop notification for new alerts.',
        facts: [['In-app', 'Notification count while the alert is open'], ['Desktop', 'Optional, per administrator and browser; needs an open console'], ['Not included', 'Email, push or webhook delivery']] }
      : { id: 'notify', title: '5 · No notification', subtitle: 'Notifications are off for this rule', color: MUTED, muted: true,
        description: 'Alerts from this rule appear in the inbox but do not add to the notification count or trigger desktop notifications.', facts: [['Turn on', 'Detection rules tab → Notify']] },
  ];
  return [...steps, LIFECYCLE].map((step) => ({ ...step, id: `${rule.id}:${step.id}` }));
}

const LIFECYCLE: Step = { id: 'lifecycle', title: '6 · Operator review', subtitle: 'Acknowledge · resolve · reopen, all audited', color: STATUS.success,
  description: 'Security operators work every alert from the inbox, one at a time or with Resolve all. Every status change is written with the operator’s identity and reason to the alert history and the hash-chained audit log.',
  facts: [['Acknowledge', 'Investigation has started; the alert stays unresolved'], ['Resolve', 'Investigation finished; later events open a new alert. The reason is optional'], ['Reopen', 'Return a resolved or acknowledged alert to open'], ['Resolve all', 'Resolves every open and acknowledged alert matching the inbox filters, audited once with the count'], ['Permission', 'Changing status requires the alert management permission']] };

/** Snake layout for six cards: three left-to-right, then three right-to-left underneath, so text stays readable. */
const SLOTS: { x: number; y: number; source: Position; target: Position }[] = [
  { x: 0, y: 0, source: Position.Right, target: Position.Left }, { x: 1, y: 0, source: Position.Right, target: Position.Left }, { x: 2, y: 0, source: Position.Bottom, target: Position.Left },
  { x: 2, y: 1, source: Position.Left, target: Position.Top }, { x: 1, y: 1, source: Position.Left, target: Position.Right }, { x: 0, y: 1, source: Position.Left, target: Position.Right },
];

/**
 * "Enabled rules" diagram: how a detection rule turns events into an alert, from the event source
 * to the operator lifecycle, using the rule's live settings. One rule is shown at a time, picked
 * from a severity-coded switcher; disabled rules are listed in a note and drawn greyed out.
 * Follows the conventions of `AccessFlow`.
 */
export function AlertRuleFlow({ rules, error, rule, onRule, selected, onSelect }: {
  rules: AlertRule[] | null; error?: string | null; rule: string; onRule: (id: string) => void; selected: string; onSelect: (id: string) => void;
}) {
  const dark = useDark();
  if (!rules) return <div className="diagram-frame">{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</div>;
  const ordered = sortRules(rules); const disabled = ordered.filter((r) => !r.enabled);
  const shown = ordered.find((r) => r.id === rule) ?? ordered.find((r) => r.enabled) ?? ordered[0];
  if (!shown) return <Empty description="No detection rules are configured." />;
  const muted = !shown.enabled;
  const steps = ruleSteps(shown);
  const current = steps.find((s) => s.id === selected);
  const nodes: Node[] = steps.map((s, i) => ({ id: s.id, position: { x: SLOTS[i]!.x * COLUMN, y: SLOTS[i]!.y * ROW }, sourcePosition: SLOTS[i]!.source, targetPosition: SLOTS[i]!.target,
    className: muted || s.muted ? 'alert-flow-muted' : undefined,
    data: { label: <div className="access-node" data-testid={`alert-flow-${s.id.replace(':', '-')}`}><strong>{s.title}</strong><span>{s.subtitle}</span><small aria-hidden="true">View details →</small></div> },
    style: { width: WIDTH, height: HEIGHT, background: dark ? '#17212b' : '#fff', color: dark ? '#e8f0f7' : '#17324d', border: `1px ${muted ? 'dashed' : 'solid'} ${s.color}`, borderInlineStart: `4px ${muted ? 'dashed' : 'solid'} ${s.color}`, borderRadius: 12, textAlign: 'start' } }));
  const edges: Edge[] = steps.slice(1).map((s, i) => ({ id: `${steps[i]!.id}-${s.id}`, source: steps[i]!.id, target: s.id, type: 'straight', markerEnd: { type: MarkerType.ArrowClosed, color: '#7192a8' }, style: { stroke: '#7192a8', strokeWidth: 1.5, strokeDasharray: muted ? '5 4' : undefined } }));
  return <div className="diagram-frame alert-flow" data-testid="alert-rule-flow">
    <div className="alert-flow-picker">
      <Select className="alert-flow-select" value={shown.id} onChange={(id) => onRule(id)} aria-label="Rule to explain" data-testid="alert-flow-picker" popupMatchSelectWidth={false} showSearch optionFilterProp="title"
        options={ordered.map((r) => ({ value: r.id, title: ALERT_RULE_NAMES[r.id] ?? r.id,
          label: <span className={`rule-severity-option${r.enabled ? '' : ' alert-flow-off'}`} style={{ ['--severity' as string]: r.enabled ? SEVERITY_COLORS[r.severity] : MUTED }} data-testid={`alert-flow-pick-${r.id}`}><i aria-hidden="true" />{ALERT_RULE_NAMES[r.id] ?? r.id}{r.enabled ? '' : ' (off)'}</span> }))} />
      <Typography.Text type="secondary" data-testid="alert-flow-count">{ordered.length - disabled.length} of {ordered.length} rules on{disabled.length > 0 ? ' · disabled rules are marked “off”' : ''}</Typography.Text>
    </div>
    {muted ? <Alert className="alert-flow-note" type="warning" showIcon data-testid="alert-flow-disabled-note"
      message={<><strong>{ALERT_RULE_NAMES[shown.id] ?? shown.id} is disabled.</strong> It does not check new events or notify anyone; earlier alerts stay in the inbox. Greyed out below is what it would do when switched on.</>} />
      : <Typography.Paragraph className="alert-flow-sentence" data-testid="alert-flow-sentence">{ruleSentence(shown)}</Typography.Paragraph>}
    <div className="access-canvas alert-flow-canvas"><DiagramView id="alert-rules" nodes={nodes} edges={edges} onSelect={onSelect}><ReactFlow key={`${shown.id}:${muted}`} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: { top: '16px', bottom: '16px', left: '56px', right: '16px' }, minZoom: 0.8, maxZoom: 1 }} minZoom={0.5} maxZoom={1.5} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}>
      <Background gap={24} /><Controls showInteractive={false} />
    </ReactFlow></DiagramView></div>
    <Modal open={!!current} title={current?.title} width={650} onCancel={() => onSelect('')} footer={<Button type="primary" onClick={() => onSelect('')}>Got it</Button>} data-testid="alert-flow-details">
      {current && <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {muted && <Alert type="warning" showIcon message="This rule is disabled; the step below only applies once it is switched on." />}
        <Typography.Paragraph>{current.description}</Typography.Paragraph>
        {current.facts.length > 0 && <Descriptions column={1} bordered size="small">{current.facts.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>}
        <Alert type="info" showIcon message="Detection runs on the server every 15 seconds. Rule changes apply to events processed after the change." />
      </Space>}
    </Modal>
  </div>;
}
