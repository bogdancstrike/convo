import { Alert, Button, Descriptions, Empty, Modal, Space, Spin, Typography } from 'antd';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AlertRule } from '../api';
import { STATUS } from '../theme';
import { DiagramView } from './DiagramView';
import { ALERT_RULE_NAMES, SEVERITY_COLORS, sortRules } from './AlertRules';
import { ruleSentenceText } from './alertRuleText';
import { useDark } from './useDark';

/** One card in the flow, with the explanation shown when it is selected. */
interface Step { id: string; title: string; subtitle: string; color: string; description: string; facts: [string, string][]; muted?: boolean }

const COLUMN = 260; const LANE = 125; const WIDTH = 220;
const SOURCE = '#2596BE'; const CONDITION = '#8075c6'; const MUTED = '#8a99a6';
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
};

/** Steps 1–5 for one enabled rule, filled in with the rule's live settings. */
function ruleSteps(rule: AlertRule): Step[] {
  const name = ALERT_RULE_NAMES[rule.id] ?? rule.id; const sev = rule.severity.toUpperCase(); const window = minutes(rule.windowMinutes);
  const source = SOURCES[rule.id] ?? { subtitle: 'Audit events', description: 'New audit entries are evaluated in order.', facts: [] };
  const counted = rule.id === 'failed-logins' ? 'failed sign-ins' : 'device enrollments';
  const condition: Step = rule.id === 'role-grant'
    ? { id: 'condition', title: '2 · Every grant counts', subtitle: 'No threshold or time window', color: CONDITION, description: 'Each privileged role grant is significant on its own, so the rule triggers for every grant. Its threshold and window are fixed at 1.', facts: [['Threshold', '1 grant (fixed)'], ['Window', 'Not used']] }
    : rule.id === 'audit-sync'
      ? { id: 'condition', title: `2 · No successful sync in ${window}`, subtitle: 'Grace period after the last good import', color: CONDITION, description: `The rule triggers when the importer has not completed a successful import for ${window}, measured from the last success or from backend startup.`, facts: [['Grace period', window], ['Recovery', 'A successful import ends the outage episode']] }
      : { id: 'condition', title: `2 · ${rule.threshold} ${counted} in ${window}`, subtitle: `Rolling window per ${rule.id === 'failed-logins' ? 'person' : 'account'}, checked at each event`, color: CONDITION,
        description: `At each new event the detector counts matching events for the same ${rule.id === 'failed-logins' ? 'person' : 'account'} in the preceding ${window}. When the count reaches ${rule.threshold}, the rule triggers.`,
        facts: [['Threshold', `${rule.threshold} events (allowed 1–1000)`], ['Window', `${window} (allowed 1–1440)`], ['Boundaries', 'The event time is included; the exact lower boundary is excluded']] };
  const episode: Step = rule.id === 'role-grant'
    ? { id: 'episode', title: '4 · One alert per grant', subtitle: 'Grants are never merged', color: SOURCE, description: 'Every grant creates its own alert so each one is reviewed separately.', facts: [['Deduplication', 'By audit entry, so retries never create duplicates']] }
    : rule.id === 'audit-sync'
      ? { id: 'episode', title: '4 · One alert per outage', subtitle: 'Recovery does not resolve it for you', color: SOURCE, description: 'While the outage continues, the same alert is updated. When imports recover, the outage marker is cleared but the alert stays open for review. A later outage raises a new alert.', facts: [['While failing', 'The existing alert is updated'], ['After recovery', 'The alert remains until an operator resolves it']] }
      : { id: 'episode', title: '4 · Extend the open alert', subtitle: `More events within ${window} update the same alert`, color: SOURCE,
        description: `While an unresolved alert exists whose latest event is within the last ${window}, new matching events extend its event count and evidence times instead of creating another alert.`,
        facts: [['New alert when', `The alert is resolved, or events pause for longer than ${window}`], ['Acknowledged alerts', 'Stay acknowledged while they are extended']] };
  const steps: Step[] = [
    { id: 'source', title: name, subtitle: `1 · ${source.subtitle}`, color: SOURCE, description: source.description, facts: source.facts },
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
  return steps.map((step) => ({ ...step, id: `${rule.id}:${step.id}` }));
}

const LIFECYCLE: Step = { id: 'lifecycle', title: '6 · Operator review', subtitle: 'Acknowledge · resolve · reopen, with a reason', color: STATUS.success,
  description: 'Security operators work every alert from the inbox. Each status change requires a reason; the reason and the operator’s identity are written to the alert history and the hash-chained audit log.',
  facts: [['Acknowledge', 'Investigation has started; the alert stays unresolved'], ['Resolve', 'Investigation finished; later events open a new alert'], ['Reopen', 'Return a resolved or acknowledged alert to open'], ['Permission', 'Changing status requires the alert management permission']] };

/**
 * "Enabled rules" diagram: how each enabled detection rule turns events into an alert, from the
 * event source to the operator lifecycle, using the rules' live settings. Disabled rules are drawn
 * greyed out without a flow. Follows the conventions of `AccessFlow`.
 */
export function AlertRuleFlow({ rules, error, selected, onSelect }: { rules: AlertRule[] | null; error?: string | null; selected: string; onSelect: (id: string) => void }) {
  const dark = useDark();
  if (!rules) return <div className="diagram-frame">{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</div>;
  const ordered = sortRules(rules); const enabled = ordered.filter((r) => r.enabled); const disabled = ordered.filter((r) => !r.enabled);
  const lanes = enabled.map(ruleSteps);
  const off: Step[] = disabled.map((r) => ({ id: `${r.id}:disabled`, title: `${ALERT_RULE_NAMES[r.id] ?? r.id} · Disabled`, subtitle: 'Not checking new events', color: MUTED, muted: true,
    description: 'This rule is turned off, so new events are not evaluated and no alerts or notifications are created by it. Alerts it raised earlier remain in the inbox with their history.',
    facts: [['When enabled', ruleSentenceText(r)], ['Turn on', 'Detection rules tab → switch in the rule header']] }));
  const steps = [...lanes.flat(), ...(lanes.length ? [LIFECYCLE] : []), ...off];
  const current = steps.find((s) => s.id === selected);
  const place = (s: Step): { x: number; y: number } => {
    if (s.id === 'lifecycle') return { x: 5 * COLUMN, y: Math.max(0, (lanes.length - 1) * LANE / 2) };
    const lane = lanes.findIndex((l) => l.includes(s));
    if (lane >= 0) return { x: lanes[lane]!.indexOf(s) * COLUMN, y: lane * LANE };
    return { x: off.indexOf(s) * COLUMN, y: lanes.length * LANE + (lanes.length ? 40 : 0) };
  };
  const nodes: Node[] = steps.map((s) => ({ id: s.id, position: place(s), sourcePosition: Position.Right, targetPosition: Position.Left, className: s.muted ? 'alert-flow-muted' : undefined,
    data: { label: <div className="access-node" data-testid={`alert-flow-${s.id.replace(':', '-')}`}><strong>{s.title}</strong><span>{s.subtitle}</span><small aria-hidden="true">View details →</small></div> },
    style: { width: WIDTH, background: dark ? '#17212b' : '#fff', color: dark ? '#e8f0f7' : '#17324d', border: `1px ${s.id.endsWith(':disabled') ? 'dashed' : 'solid'} ${s.color}`, borderInlineStart: `4px ${s.id.endsWith(':disabled') ? 'dashed' : 'solid'} ${s.color}`, borderRadius: 12, textAlign: 'start', opacity: s.id.endsWith(':disabled') ? 0.75 : 1 } }));
  const edge = (source: string, target: string, step = false): Edge => ({ id: `${source}-${target}`, source, target, type: step ? 'smoothstep' : 'straight', markerEnd: { type: MarkerType.ArrowClosed, color: '#7192a8' }, style: { stroke: '#7192a8', strokeWidth: 1.5 } });
  const edges = lanes.flatMap((lane) => [...lane.slice(1).map((s, i) => edge(lane[i]!.id, s.id)), edge(lane[lane.length - 1]!.id, LIFECYCLE.id, true)]);
  return <div className="diagram-frame" data-testid="alert-rule-flow">
    {disabled.length > 0 && <Alert className="alert-flow-note" type="warning" showIcon data-testid="alert-flow-disabled-note"
      message={<><strong>Disabled: {disabled.map((r) => ALERT_RULE_NAMES[r.id] ?? r.id).join(', ')}.</strong> Shown greyed out without a flow; {disabled.length === 1 ? 'it does' : 'they do'} not check new events or notify anyone. Earlier alerts stay in the inbox.</>} />}
    {!lanes.length && <Empty className="alert-flow-note" description="No detection rules are enabled, so no new security alerts will be raised." />}
    <div className="access-canvas"><DiagramView id="alert-rules" nodes={nodes} edges={edges} onSelect={onSelect}><ReactFlow key={steps.map((s) => s.id).join()} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }} minZoom={0.2} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}>
      <Background gap={24} /><Controls showInteractive={false} />
    </ReactFlow></DiagramView></div>
    <Modal open={!!current} title={current?.title} width={650} onCancel={() => onSelect('')} footer={<Button type="primary" onClick={() => onSelect('')}>Got it</Button>} data-testid="alert-flow-details">
      {current && <Space direction="vertical" size="middle" style={{ width: '100%' }}><Typography.Paragraph>{current.description}</Typography.Paragraph>
        {current.facts.length > 0 && <Descriptions column={1} bordered size="small">{current.facts.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>}
        <Alert type="info" showIcon message="Detection runs on the server every 15 seconds. Rule changes apply to events processed after the change." />
      </Space>}
    </Modal>
  </div>;
}
