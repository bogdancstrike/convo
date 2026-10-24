import { DiagramView } from './DiagramView';
import { Alert, Button, Descriptions, Modal, Space, Typography } from 'antd';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { useDark } from './useDark';

const STAGES = [
  { id: 'admin', title: '1 · Open the console', subtitle: 'A separate workspace for administrators', x: 0, y: 110, color: '#2596BE',
    description: 'The administration console runs separately from the messenger. Sign in with your organization account to see the tools assigned to your roles.',
    facts: [['Your identity', 'The audit log ties actions to your organization identity.'], ['Access', 'A regular Convo user cannot use the admin API without an administrator role.'], ['Privacy', 'The console has no API for reading message content or encryption keys.']] },
  { id: 'signin', title: '2 · Verify your identity', subtitle: 'Organization sign-in · passkey or password', x: 310, y: 0, color: '#8075c6',
    description: 'Your organization identity provider verifies who you are and issues a short-lived access token. The console renews that token while your sign-in session is valid.',
    facts: [['Methods', 'Passwords, passkeys and authenticator requirements are controlled by your organization.'], ['Session renewal', 'Refreshing a token keeps you signed in; it does not count as a new sign-in for sensitive actions.'], ['Audit', 'Login, logout, failed sign-ins and credential changes are imported from the identity provider.']] },
  { id: 'permission', title: '3 · Check permissions', subtitle: 'Roles combine to determine access', x: 620, y: 110, color: '#2596BE',
    description: 'Every API request is checked against the permissions granted by your current administrator roles. Hiding a control in the console is only a convenience; the server enforces access.',
    facts: [['Combined roles', 'Multiple roles grant the union of their permissions. Roles do not inherit from one another.'], ['Changing access', 'An assignment becomes effective when the person receives a renewed token or signs in again.'], ['Self changes', 'Another administrator must manage your own roles and credentials.']] },
  { id: 'stepup', title: '4 · Confirm sensitive changes', subtitle: 'Recent sign-in + a recorded reason', x: 930, y: 0, color: '#d99835',
    description: 'High-impact changes require a recent organization sign-in. If the server asks you to sign in again, complete sign-in and retry the action.',
    facts: [['Recent sign-in', 'By default, sensitive changes need an auth_time within ten minutes. Token renewal does not reset this time.'], ['Reasons', 'Administrative changes require an explanation that is stored with the action.'], ['Examples', 'Disabling an account, unlinking a device, resetting passwords and changing roles have additional checks.']] },
  { id: 'action', title: '5 · Apply the change', subtitle: 'Account, device or access management', x: 1240, y: 110, color: '#2E9D6A',
    description: 'The requested operation is applied within its permitted scope. Account access, sign-in access and linked devices are separate controls; review the confirmation before making a change.',
    facts: [['Disable Convo account', 'Stops the account’s devices from using Convo.'], ['Block organization sign-in', 'Prevents new sign-ins and ends identity-provider sessions. Existing Convo devices are managed separately.'], ['Unlink a device', 'Revokes that device’s access and delivery. Other linked devices remain available.']] },
  { id: 'denied', title: 'Request refused', subtitle: 'No permission or recent sign-in', x: 620, y: 320, color: '#D14B4B',
    description: 'A request is refused if the required role, permission or recent sign-in is missing. The server does not apply the requested change.',
    facts: [['Permission missing', 'Ask an administrator to review your role assignments.'], ['Recent sign-in missing', 'Sign in again before retrying a sensitive action.'], ['Audit', 'Denied administrative changes record the attempted action and the missing permission.']] },
  { id: 'audit', title: '6 · Record the audit trail', subtitle: 'Who · what · when · why', x: 1240, y: 320, color: '#2596BE',
    description: 'Administrative and user identity actions are written to a hash-chained audit log. Each entry binds the previous entry, so verification detects edits or missing entries.',
    facts: [['Timing', 'Device changes are recorded immediately. Identity-provider events arrive through a poll every fifteen seconds.'], ['Verification', 'Compare the chain against independent checkpoints to detect a database rewrite. Keep checkpoints off-host or on write-once storage.'], ['Boundaries', 'Audit contains action metadata. It does not contain messages, keys, credential secrets or client-local settings.']] },
];

export function AccessFlow({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const dark = useDark();
  const current = STAGES.find((s) => s.id === selected);
  const nodes: Node[] = STAGES.map((s) => ({ id: s.id, position: { x: s.x, y: s.y }, sourcePosition: Position.Right, targetPosition: Position.Left,
    data: { label: <div className="access-node"><strong>{s.title}</strong><span>{s.subtitle}</span><small>View details →</small></div> },
    style: { width: 250, background: dark ? '#17212b' : '#fff', color: dark ? '#e8f0f7' : '#17324d', border: `1px solid ${s.color}`, borderInlineStart: `4px solid ${s.color}`, borderRadius: 12, textAlign: 'start' } }));
  const edge = (source: string, target: string, label?: string): Edge => ({ id: `${source}-${target}`, source, target, label, type: 'straight', markerEnd: { type: MarkerType.ArrowClosed, color: '#7192a8' }, style: { stroke: '#7192a8', strokeWidth: 1.5 }, labelStyle: { fontSize: 11 } });
  const edges = [edge('admin', 'signin'), edge('signin', 'permission'), edge('permission', 'stepup'), edge('stepup', 'action'), edge('permission', 'denied', 'refused'), edge('denied', 'audit', 'record attempt'), edge('action', 'audit', 'record change')];
  return <div className="diagram-frame" data-testid="access-flow"><Typography.Paragraph type="secondary">Follow an administrator request from sign-in to the audit trail. Select a card to understand its checks and what to do next.</Typography.Paragraph>
    <div className="access-canvas"><DiagramView id="access" nodes={nodes} edges={edges} onSelect={onSelect}><ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.25} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}>
      <Background gap={24} /><Controls showInteractive={false} />
    </ReactFlow></DiagramView></div>
    <Modal open={!!current} title={current?.title} width={650} onCancel={() => onSelect('')} footer={<Button type="primary" onClick={() => onSelect('')}>Got it</Button>} data-testid="access-details">
      {current && <Space direction="vertical" size="middle" style={{ width: '100%' }}><Typography.Paragraph>{current.description}</Typography.Paragraph>
        <Descriptions column={1} bordered size="small">{current.facts.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>
        <Alert type="info" showIcon message="The console shows controls for your roles. The server checks every request independently." />
      </Space>}
    </Modal>
  </div>;
}
