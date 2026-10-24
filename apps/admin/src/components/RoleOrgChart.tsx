import { ChartCard } from './ChartCard';
import { DiagramView } from './DiagramView';
import { useMemo } from 'react';
import { Button, Descriptions, Empty, Input, Pagination, Select, Space, Tag, Typography } from 'antd';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { RoleHolder, RoleView } from '../api';
import { PERMISSIONS, ROLE_LABELS } from '../format';
import { useDark } from './useDark';

interface ChartView { chartRole: string; chartSearch: string; chartNode: string; chartPage: string }

/** An expandable assignment graph. URL-backed focus and search make Back restore the prior graph. */
export function RoleOrgChart({ roles, view, update, onPerson, onRole, canManage }: {
  roles: RoleView[]; view: ChartView; update: (patch: Partial<ChartView>, replace?: boolean) => void;
  onPerson: (id: string, tab?: string) => void; onRole: (role: string) => void; canManage: boolean;
}) {
  const dark = useDark();
  const allPeople = useMemo(() => new Map(roles.flatMap((r) => r.holders.map((h) => [h.id, h] as const))), [roles]);
  const selectedRole = roles.find((r) => `role:${r.role}` === view.chartNode);
  const selectedPerson = view.chartNode.startsWith('person:') ? allPeople.get(view.chartNode.slice(7)) : undefined;
  const personRoles = selectedPerson ? roles.filter((r) => r.holders.some((h) => h.id === selectedPerson.id)) : [];
  const permissions = [...new Set((selectedRole ? [selectedRole] : personRoles).flatMap((r) => r.permissions))];
  const graph = useMemo(() => {
    const search = view.chartSearch.trim().toLowerCase();
    const scope = roles.filter((r) => view.chartRole === 'all' || r.role === view.chartRole);
    const matches = (h: RoleHolder, r: RoleView) => !search || `${h.username} ${h.firstName ?? ''} ${h.lastName ?? ''} ${ROLE_LABELS[r.role] ?? r.role}`.toLowerCase().includes(search);
    const visibleRoles = scope.filter((r) => !search || (ROLE_LABELS[r.role] ?? r.role).toLowerCase().includes(search) || r.holders.some((h) => matches(h, r)));
    const people = new Map<string, RoleHolder>();
    if (view.chartRole !== 'all' || search) for (const r of visibleRoles) for (const h of r.holders) if (matches(h, r)) people.set(h.id, h);
    const matched = [...people.values()].sort((a, b) => a.username.localeCompare(b.username));
    const page = Math.max(1, Math.min(Number(view.chartPage) || 1, Math.ceil(matched.length / 8) || 1));
    const shown = matched.slice((page - 1) * 8, page * 8);
    const height = Math.max(visibleRoles.length * 125, shown.length * 90, 150);
    const color = dark ? '#eaf2fa' : '#17324D';
    const box = (id: string) => ({ width: 215, padding: 14, borderRadius: 12, color, background: dark ? '#17212b' : '#fff',
      border: `1px solid ${view.chartNode === id ? '#2596BE' : dark ? '#4a5c6e' : '#b8cad7'}`, boxShadow: view.chartNode === id ? '0 0 0 3px #2596be30' : undefined });
    const nodes: Node[] = [
      { id: 'organization', position: { x: 0, y: height / 2 - 35 }, data: { label: <><strong>Convo administration</strong><div>{roles.length} roles · {allPeople.size} people</div><small>Organization overview</small></> }, style: { ...box('organization'), background: dark ? '#153849' : '#eaf6fa' }, sourcePosition: Position.Right },
      ...visibleRoles.map((r, i) => ({ id: `role:${r.role}`, position: { x: 300, y: visibleRoles.length === 1 ? height / 2 - 35 : i * 125 }, data: { label: <><strong>{ROLE_LABELS[r.role] ?? r.role}</strong><div>{r.holders.length} people · {r.permissions.length} permissions</div><small>Explore this role →</small></> }, style: box(`role:${r.role}`), sourcePosition: Position.Right, targetPosition: Position.Left })),
      ...shown.map((h, i) => ({ id: `person:${h.id}`, position: { x: 610, y: i * 90 }, data: { label: <><strong>@{h.username}</strong><div>{[h.firstName, h.lastName].filter(Boolean).join(' ') || 'Organization account'}</div>{!h.enabled && <small style={{ color: '#c85050' }}>Sign-in blocked</small>}</> }, style: box(`person:${h.id}`), targetPosition: Position.Left })),
    ];
    const edge = (source: string, target: string): Edge => ({ id: `${source}:${target}`, source, target, type: 'straight', style: { stroke: '#7398ad', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#7398ad' } });
    const edges = visibleRoles.flatMap((r) => [edge('organization', `role:${r.role}`), ...shown.filter((h) => r.holders.some((p) => p.id === h.id)).map((h) => edge(`role:${r.role}`, `person:${h.id}`))]);
    return { nodes, edges, count: matched.length, page, roleCount: visibleRoles.length };
  }, [roles, view.chartRole, view.chartSearch, view.chartNode, view.chartPage, allPeople, dark]);
  const reset = () => update({ chartRole: 'all', chartSearch: '', chartNode: '', chartPage: '1' });
  return <ChartCard title="Organization chart" className="organization-card" data-testid="role-organigram">
    <div className="chart-toolbar"><Select aria-label="Filter organization chart by role" value={view.chartRole} onChange={(chartRole) => update({ chartRole, chartNode: chartRole === 'all' ? '' : `role:${chartRole}`, chartPage: '1' })}
      options={[{ value: 'all', label: 'All roles' }, ...roles.map((r) => ({ value: r.role, label: ROLE_LABELS[r.role] ?? r.role }))]} />
      <Input.Search allowClear aria-label="Search organization chart" placeholder="Search people or roles" value={view.chartSearch} onChange={(e) => update({ chartSearch: e.target.value, chartPage: '1' }, true)} />
      {(view.chartRole !== 'all' || view.chartSearch) && <Button onClick={reset}>Full organization</Button>}
    </div>
    <div className="chart-workspace"><div>
      <div className="organization-canvas"><DiagramView id="organization" nodes={graph.nodes} edges={graph.edges} onSelect={(id) => id === 'organization' ? reset() : id.startsWith('role:') ? update({ chartRole: id.slice(5), chartNode: id, chartPage: '1' }) : update({ chartNode: id })}><ReactFlow key={`${view.chartRole}:${view.chartSearch}:${graph.page}:${graph.count}`} nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ maxZoom: 1, padding: 0.12 }} minZoom={0.2} colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => n.id === 'organization' ? reset() : n.id.startsWith('role:') ? update({ chartRole: n.id.slice(5), chartNode: n.id, chartPage: '1' }) : update({ chartNode: n.id })}>
        <Background gap={24} /><Controls showInteractive={false} />
      </ReactFlow></DiagramView></div>
      <div className="chart-caption"><Typography.Text type="secondary">{!graph.roleCount ? 'No matching roles or people.' : view.chartRole === 'all' && !view.chartSearch ? 'Select a role to expand its people. Each line represents a role assignment.' : `${graph.count} matching people · select a card for details`}</Typography.Text>
        {graph.count > 8 && <Pagination size="small" current={graph.page} total={graph.count} pageSize={8} showSizeChanger={false} onChange={(page) => update({ chartPage: String(page) })} />}</div>
    </div>
    <aside className="chart-inspector" aria-label="Organization card details" data-testid="organization-details">
      {selectedRole ? <><div className="eyebrow">Administrator role</div><h2>{ROLE_LABELS[selectedRole.role] ?? selectedRole.role}</h2><Typography.Paragraph type="secondary">{selectedRole.holders.length} people have this role. It grants {selectedRole.permissions.length} permissions.</Typography.Paragraph>
        <Button type="primary" onClick={() => onRole(selectedRole.role)}>{canManage ? 'Manage role & people' : 'Explore role & people'}</Button>
        <Descriptions column={1} size="small" style={{ marginTop: 20 }}><Descriptions.Item label="Sign-in allowed">{selectedRole.holders.filter((h) => h.enabled).length}</Descriptions.Item><Descriptions.Item label="Sign-in blocked">{selectedRole.holders.filter((h) => !h.enabled).length}</Descriptions.Item></Descriptions>
      </> : selectedPerson ? <><div className="eyebrow">Organization account</div><h2>@{selectedPerson.username}</h2><Typography.Paragraph>{[selectedPerson.firstName, selectedPerson.lastName].filter(Boolean).join(' ')}</Typography.Paragraph><Tag color={selectedPerson.enabled ? 'green' : 'red'}>{selectedPerson.enabled ? 'Sign-in allowed' : 'Sign-in blocked'}</Tag>
        <Space wrap style={{ marginBlock: 20 }}><Button type="primary" onClick={() => onPerson(selectedPerson.id)}>Open user</Button><Button onClick={() => onPerson(selectedPerson.id, 'security')}>Security</Button>{canManage && <Button onClick={() => onPerson(selectedPerson.id, 'roles')}>Manage roles</Button>}</Space>
        <Typography.Title level={5}>Assigned roles</Typography.Title><Space wrap>{personRoles.map((r) => <Tag key={r.role}>{ROLE_LABELS[r.role] ?? r.role}</Tag>)}</Space>
      </> : <><div className="eyebrow">Organization access</div><h2>Who can do what</h2><Typography.Paragraph type="secondary">Start with a role, then select a person. Details and quick actions appear here.</Typography.Paragraph><Descriptions column={1}><Descriptions.Item label="Roles">{roles.length}</Descriptions.Item><Descriptions.Item label="People">{allPeople.size}</Descriptions.Item></Descriptions><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a card in the chart" /></>}
      {!!permissions.length && <><Typography.Title level={5}>Effective permissions</Typography.Title><div className="inspector-permissions">{permissions.map((p) => <div key={p}><span>{PERMISSIONS[p]?.label ?? p}</span><small>{PERMISSIONS[p]?.group}</small></div>)}</div></>}
    </aside></div>
  </ChartCard>;
}
