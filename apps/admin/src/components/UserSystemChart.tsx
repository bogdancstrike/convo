import { DiagramView } from './DiagramView';
import { DiagramPanel } from './ChartCard';
import { USER_CARD, userSystemLayout } from './userSystemLayout';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ApartmentOutlined, DesktopOutlined, FullscreenOutlined, IdcardOutlined, MobileOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps, type Rect } from '@xyflow/react';
import { api, type AccountSummary, type DeviceSummary, type RoleView, type SignInAccount } from '../api';
import { CREDENTIAL_LABELS, fmtDay, fmtTime, PERMISSIONS, ROLE_LABELS } from '../format';
import { useDark } from './useDark';

interface CardData { title: string; subtitle: string; kind: 'organization' | 'person' | 'identity' | 'account' | 'role' | 'device'; rows: [string, string][]; role?: string; tab?: string }
function SystemCard({ data }: NodeProps) {
  const kind = data.kind as CardData['kind'];
  return <>
    {kind !== 'organization' && <Handle type="target" id={kind === 'identity' ? 'top' : 'left'} position={kind === 'identity' ? Position.Top : Position.Left} />}
    {['organization', 'person', 'identity', 'account'].includes(kind) && <Handle type="source" id="right" position={Position.Right} style={{ opacity: data.outgoing ? 1 : 0 }} />}
    {kind === 'person' && <Handle type="source" id="bottom" position={Position.Bottom} />}
    {data.label as ReactNode}
  </>;
}
const NODE_TYPES = { system: SystemCard };
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
    const positions = userSystemLayout(assigned.map((r) => `role:${r.role}`), deviceRows.map((d) => `device:${d.deviceId}`));
    const cards: { id: string; data: CardData }[] = [
      { id: 'organization', data: { kind: 'organization', title: 'Convo organization', subtitle: 'Organization workspace', rows: [['Workspace', 'Convo'], ['Access', 'Identity + devices']] } },
      { id: 'person', data: { kind: 'person', title: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || account?.displayName || user?.username || 'User', subtitle: `@${user?.username ?? account?.username ?? ''}`, rows: [['Phone', user?.phone || 'Not set'], ['Convo', account ? account.status : 'Not joined yet'], ['Admin roles', String(user?.roles.length ?? 0)]] } },
      { id: 'identity', data: { kind: 'identity', title: 'Organization sign-in', subtitle: user?.enabled ? 'Sign-in allowed' : user ? 'Sign-in blocked' : 'Identity unavailable', tab: 'security', rows: [['Methods', user?.credentialTypes.map((c) => CREDENTIAL_LABELS[c] ?? c).join(', ') || 'Not available'], ['Sessions', String(user?.sessions ?? '—')]] } },
      { id: 'account', data: { kind: 'account', title: 'Convo account', subtitle: account ? account.status === 'active' ? 'Access enabled' : 'Access disabled' : 'Awaiting first sign-in', tab: 'overview', rows: [['Joined', fmtDay(account?.createdAt)], ['Linked devices', String(account?.activeDevices ?? 0)]] } },
      ...assigned.map((r) => ({ id: `role:${r.role}`, data: { kind: 'role' as const, title: ROLE_LABELS[r.role] ?? r.role, subtitle: r.permissions.length ? `${r.permissions.length} scoped permissions` : 'Scoped administrator access', role: r.role, tab: 'roles', rows: [['Assigned to', user?.username ?? 'User'], ['Scope', 'Administrator console']] as [string, string][] } })),
      ...deviceRows.map((d) => ({ id: `device:${d.deviceId}`, data: { kind: 'device' as const, title: d.platform === 'android' ? 'Android device' : d.platform === 'web' ? 'Web browser' : d.platform, subtitle: `Device #${d.deviceId} · linked`, tab: 'devices', rows: [['Linked', fmtDay(d.createdAt)], ['Last active', fmtDay(d.lastSeenDay)]] as [string, string][] } })),
    ];
    const icons = { organization: <ApartmentOutlined />, person: <UserOutlined />, identity: <SafetyCertificateOutlined />, account: <IdcardOutlined />, role: <SafetyCertificateOutlined />, device: <DesktopOutlined /> };
    const kinds = { organization: 'Workspace', person: 'Person', identity: 'Sign-in', account: 'Account', role: 'Admin role', device: 'Linked device' };
    const nodes: Node[] = cards.map((c) => ({ id: c.id, type: 'system', position: positions[c.id]!,
      data: { kind: c.data.kind, outgoing: c.data.kind === 'organization' || c.data.kind === 'person' || (c.data.kind === 'identity' && !!assigned.length) || (c.data.kind === 'account' && !!deviceRows.length), label: <div className={`system-node system-node-${c.data.kind}`}><div className="system-node-top"><span className="system-node-icon">{c.data.kind === 'device' && c.data.title === 'Android device' ? <MobileOutlined /> : icons[c.data.kind]}</span><span className="system-node-kicker">{kinds[c.data.kind]}</span><span className="system-node-open" aria-hidden="true">↗</span></div>
        <strong title={c.data.title}>{c.data.title}</strong><span className="system-node-subtitle" title={c.data.subtitle}>{c.data.subtitle}</span><div className="system-node-facts">{c.data.rows.map(([label, value]) => <span key={label}><small>{label}</small><b title={value}>{value}</b></span>)}</div></div> },
      style: { width: USER_CARD.width, height: USER_CARD.height, border: 0, padding: 0, background: 'transparent', borderRadius: 12 } }));
    const edge = (source: string, target: string): Edge => ({ id: `${source}:${target}`, source, target, sourceHandle: target === 'identity' ? 'bottom' : 'right', targetHandle: target === 'identity' ? 'top' : 'left', type: 'straight', style: { stroke: dark ? '#6191aa' : '#87a7bb', strokeWidth: 1.8 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6191aa' } });
    const bounds = { x: 0, y: 0, width: Math.max(...nodes.map((n) => n.position.x)) + USER_CARD.width, height: Math.max(...nodes.map((n) => n.position.y)) + USER_CARD.height };
    return { cards, nodes, bounds, edges: [edge('organization', 'person'), edge('person', 'identity'), edge('person', 'account'), ...assigned.map((r) => edge('identity', `role:${r.role}`)), ...deviceRows.map((d) => edge('account', `device:${d.deviceId}`))] };
  }, [roles, user, account, devices, dark]);
  const flow = useRef<ReturnType<typeof useReactFlow> | null>(null);
  const card = graph.cards.find((c) => c.id === selected)?.data;
  return <DiagramPanel className="user-organization-panel" title="Place in the organization" description="Identity, access and devices — select a card to explore." extra={<Button type="text" icon={<FullscreenOutlined />} aria-label="Fit organization to view" onClick={() => void flow.current?.fitBounds(graph.bounds, { padding: 0.08, duration: 250 })} />}><div data-testid="user-organization">
    {user && !user.roles.length && <Alert type="info" showIcon message="This person has no administrator roles." className="user-organization-notice" />}
    <div className="user-system-canvas"><DiagramView id="user-system" nodes={graph.nodes} edges={graph.edges} onSelect={onSelect}><ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={NODE_TYPES} minZoom={0.12} onInit={(instance) => { flow.current = instance; }} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}><FitGraph bounds={graph.bounds} /><Background gap={24} size={1} /><Controls showInteractive={false} /></ReactFlow></DiagramView></div>
    <Modal open={!!card} title={card?.title} onCancel={() => onSelect('')} footer={<Space><Button onClick={() => onSelect('')}>Close</Button>{card?.tab && <Button type="primary" onClick={() => { onSelect(''); onTab(card.tab!); }}>Open {card.tab}</Button>}</Space>}>
      {card && <><Typography.Paragraph>{card.subtitle}</Typography.Paragraph><Descriptions column={1} bordered>{card.rows.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>
        {card.kind === 'device' && (() => { const d = devices?.find((v) => `device:${v.deviceId}` === selected); return d && <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>Device #{d.deviceId} was linked {fmtTime(d.createdAt)}. Last activity is shown at day granularity; a live online state is not inferred.</Typography.Paragraph>; })()}
        {card.role && <Space wrap style={{ marginTop: 16 }}>{roles.find((r) => r.role === card.role)?.permissions.map((p) => <Tag key={p}>{PERMISSIONS[p]?.label ?? p}</Tag>)}</Space>}
      </>}
    </Modal>
  </div></DiagramPanel>;
}

/** Fit the complete fixed-size layout, including devices not yet measured by React Flow. */
function FitGraph({ bounds: { x, y, width, height } }: { bounds: Rect }) {
  const { fitBounds, viewportInitialized } = useReactFlow();
  // The viewport container changes size when the sidebar or lateral view changes.
  const viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!viewportInitialized) return;
    const container = viewport.current?.closest('.react-flow');
    if (!container) return;
    let frame = 0;
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void fitBounds({ x, y, width, height }, { padding: 0.08 }); }); };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [viewportInitialized, x, y, width, height, fitBounds]);
  return <div ref={viewport} hidden />;
}
