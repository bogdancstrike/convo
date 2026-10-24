import { DiagramView } from './DiagramView';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ApartmentOutlined, DesktopOutlined, IdcardOutlined, MobileOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { api, type AccountSummary, type DeviceSummary, type RoleView, type SignInAccount } from '../api';
import { CREDENTIAL_LABELS, fmtDay, fmtTime, PERMISSIONS, ROLE_LABELS } from '../format';
import { useDark } from './useDark';

interface CardData { title: string; subtitle: string; kind: 'organization' | 'person' | 'identity' | 'account' | 'role' | 'device'; rows: [string, string][]; role?: string; tab?: string }
export function UserSystemChart({ identity, account, devices, selected, onSelect, onTab }: {
  identity: SignInAccount | null; account: AccountSummary | null; devices: DeviceSummary[] | null;
  selected: string; onSelect: (id: string) => void; onTab: (tab: string) => void;
}) {
  const dark = useDark();
  const [roles, setRoles] = useState<RoleView[]>([]);
  useEffect(() => { let active = true; void api.roles().then((r) => { if (active) setRoles(r); }).catch(() => undefined); return () => { active = false; }; }, []);
  const user = identity?.user;
  const graph = useMemo(() => {
    const assigned = (user?.roles ?? []).map((role) => roles.find((r) => r.role === role) ?? { role, permissions: [], holders: [] });
    const deviceRows = devices ?? [];
    const cards: { id: string; x: number; y: number; data: CardData }[] = [
      { id: 'organization', x: 0, y: 160, data: { kind: 'organization', title: 'Convo organization', subtitle: 'Organization workspace', rows: [['Access model', 'Organization identity + linked devices']] } },
      { id: 'person', x: 330, y: 160, data: { kind: 'person', title: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || account?.displayName || user?.username || 'User', subtitle: `@${user?.username ?? account?.username ?? ''}`, rows: [['Phone', user?.phone || 'Not set'], ['Convo', account ? account.status : 'Not joined yet'], ['Admin roles', String(user?.roles.length ?? 0)]] } },
      { id: 'identity', x: 660, y: -60, data: { kind: 'identity', title: 'Organization sign-in', subtitle: user?.enabled ? 'Sign-in allowed' : user ? 'Sign-in blocked' : 'Identity unavailable', tab: 'security', rows: [['Methods', user?.credentialTypes.map((c) => CREDENTIAL_LABELS[c] ?? c).join(', ') || 'Not available'], ['Sessions', String(user?.sessions ?? '—')]] } },
      { id: 'account', x: 660, y: 290, data: { kind: 'account', title: 'Convo account', subtitle: account ? account.status === 'active' ? 'Access enabled' : 'Access disabled' : 'Awaiting first sign-in', tab: 'overview', rows: [['Joined', fmtDay(account?.createdAt)], ['Linked devices', String(account?.activeDevices ?? 0)]] } },
      ...assigned.map((r, i) => ({ id: `role:${r.role}`, x: 1010, y: -180 - i * 185, data: { kind: 'role' as const, title: ROLE_LABELS[r.role] ?? r.role, subtitle: r.permissions.length ? `${r.permissions.length} scoped permissions` : 'Scoped administrator access', role: r.role, tab: 'roles', rows: [['Assigned to', user?.username ?? 'User'], ['Scope', 'Administrator console']] as [string, string][] } })),
      ...deviceRows.map((d, i) => ({ id: `device:${d.deviceId}`, x: 1010, y: 250 + i * 190, data: { kind: 'device' as const, title: d.platform === 'android' ? 'Android device' : d.platform === 'web' ? 'Web browser' : d.platform, subtitle: `Device #${d.deviceId} · linked`, tab: 'devices', rows: [['Linked', fmtDay(d.createdAt)], ['Last active', fmtDay(d.lastSeenDay)]] as [string, string][] } })),
    ];
    const icons = { organization: <ApartmentOutlined />, person: <UserOutlined />, identity: <SafetyCertificateOutlined />, account: <IdcardOutlined />, role: <SafetyCertificateOutlined />, device: <DesktopOutlined /> };
    const nodes: Node[] = cards.map((c) => ({ id: c.id, position: { x: c.x, y: c.y }, sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: <div className={`system-node system-node-${c.data.kind}`}><div className="system-node-top"><span className="system-node-icon">{c.data.kind === 'device' && c.data.title === 'Android device' ? <MobileOutlined /> : icons[c.data.kind]}</span><span className="system-node-kicker">{c.data.kind === 'device' ? 'Linked device' : c.data.kind}</span><span className="system-node-indicator" /></div>
        <strong>{c.data.title}</strong><span className="system-node-subtitle">{c.data.subtitle}</span><div className="system-node-facts">{c.data.rows.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div></div> },
      style: { width: 265, border: 0, padding: 0, background: 'transparent', borderRadius: 16 } }));
    const edge = (source: string, target: string): Edge => ({ id: `${source}:${target}`, source, target, type: 'straight', style: { stroke: dark ? '#6191aa' : '#87a7bb', strokeWidth: 1.8 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6191aa' } });
    return { cards, nodes, edges: [edge('organization', 'person'), edge('person', 'identity'), edge('person', 'account'), ...assigned.map((r) => edge('identity', `role:${r.role}`)), ...deviceRows.map((d) => edge('account', `device:${d.deviceId}`))] };
  }, [roles, user, account, devices, dark]);
  const card = graph.cards.find((c) => c.id === selected)?.data;
  return <div data-testid="user-organization"><Typography.Paragraph type="secondary">The person's sign-in identity, administrator access and linked devices. Select a card for details. Private conversation membership is not exposed.</Typography.Paragraph>
    {user && !user.roles.length && <Alert type="info" showIcon message="This person has no administrator roles." style={{ marginBottom: 12 }} />}
    <div className="user-system-canvas"><DiagramView id="user-system" nodes={graph.nodes} edges={graph.edges} onSelect={onSelect}><ReactFlow nodes={graph.nodes} edges={graph.edges} fitView minZoom={0.15} fitViewOptions={{ maxZoom: 0.85, padding: 0.1 }} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}><Background gap={28} /><Controls showInteractive={false} /></ReactFlow></DiagramView></div>
    <Modal open={!!card} title={card?.title} onCancel={() => onSelect('')} footer={<Space><Button onClick={() => onSelect('')}>Close</Button>{card?.tab && <Button type="primary" onClick={() => { onSelect(''); onTab(card.tab!); }}>Open {card.tab}</Button>}</Space>}>
      {card && <><Typography.Paragraph>{card.subtitle}</Typography.Paragraph><Descriptions column={1} bordered>{card.rows.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>
        {card.kind === 'device' && (() => { const d = devices?.find((v) => `device:${v.deviceId}` === selected); return d && <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>Device #{d.deviceId} was linked {fmtTime(d.createdAt)}. Last activity is shown at day granularity; a live online state is not inferred.</Typography.Paragraph>; })()}
        {card.role && <Space wrap style={{ marginTop: 16 }}>{roles.find((r) => r.role === card.role)?.permissions.map((p) => <Tag key={p}>{PERMISSIONS[p]?.label ?? p}</Tag>)}</Space>}
      </>}
    </Modal>
  </div>;
}
