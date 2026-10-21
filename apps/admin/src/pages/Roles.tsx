import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, AutoComplete, Avatar, Button, Card, Col, Empty, List, Row, Space, Tabs, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, errorText, type RoleView, type SignInAccount } from '../api';
import { useReason } from '../components/confirm';
import { useDark } from '../components/useDark';
import { PERMISSIONS, ROLE_LABELS } from '../format';
import { BRAND, SERIES } from '../theme';
import type { PageProps } from '../Shell';

const ROLE_HELP: Record<string, string> = {
  'convo-admin': 'Everything, including granting roles. Keep this to very few people.',
  'convo-security': 'Incidents: accounts, devices, disabling, credentials, recovery kits, audit, health.',
  'convo-org-admin': 'Membership: create sign-in accounts, disable/enable, credentials, statistics.',
  'convo-helpdesk': 'Support: devices, credentials, lost recovery kits, statistics, health.',
  'convo-auditor': 'Read-only oversight: audit log (verify, export, checkpoint) and statistics.',
};
const GROUP_COLOR: Record<string, string> = { People: SERIES[0], 'Sign-in': SERIES[2], Audit: SERIES[3], Operations: SERIES[4] };

/** Admin roles: who has them, what they allow (diagram), and how an admin request is checked. */
export function RolesPage({ can }: PageProps) {
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { void api.roles().then(setRoles).catch((e) => setError(errorText(e))); }, []);
  useEffect(load, [load]);
  return (
    <div data-testid="admin-roles-page">
      <div className="page-head">
        <div><h1>Roles &amp; permissions</h1><p>Administrator roles at the organization's sign-in service. The server enforces each permission on every request; this console only hides what a role cannot do.</p></div>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Tabs items={[
        { key: 'roles', label: 'Roles and people', children: <RoleCards roles={roles} can={can} onChanged={load} /> },
        { key: 'map', label: 'Permission map', children: <Card><PermissionMap roles={roles ?? []} /></Card> },
        { key: 'flow', label: 'How access works', children: <Card><AccessFlow /></Card> },
      ]} />
    </div>
  );
}

function RoleCards({ roles, can, onChanged }: { roles: RoleView[] | null; can: PageProps['can']; onChanged: () => void }) {
  const { message } = App.useApp();
  const ask = useReason();
  const [query, setQuery] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, SignInAccount[]>>({});
  const manage = can('ROLES_MANAGE');
  const search = (role: string, q: string) => {
    setQuery((s) => ({ ...s, [role]: q }));
    if (q.trim().length < 2) return;
    void api.idpUsers(q).then((u) => setOptions((s) => ({ ...s, [role]: u.slice(0, 8) }))).catch(() => undefined);
  };
  const change = async (role: string, id: string, username: string, grant: boolean) => {
    const label = ROLE_LABELS[role] ?? role;
    const reason = await ask(grant ? `Grant ${label} to ${username}` : `Remove ${label} from ${username}`,
      grant ? 'Takes effect at their next sign-in to this console.' : 'They lose these permissions at their next sign-in.', grant);
    if (!reason) return;
    try { await api.setRole(id, role, grant, reason); message.success(grant ? 'Role granted' : 'Role removed'); setQuery((s) => ({ ...s, [role]: '' })); onChanged(); }
    catch (e) { message.error(errorText(e)); }
  };
  if (!roles) return <Card loading />;
  return (
    <Row gutter={[16, 16]}>
      {roles.map((r) => (
        <Col key={r.role} xs={24} lg={12} xxl={8}>
          <Card title={<Space>{ROLE_LABELS[r.role] ?? r.role}<Tag>{r.holders.length}</Tag></Space>} data-testid={`role-card-${r.role}`}
            extra={<Typography.Text type="secondary" code>{r.role}</Typography.Text>}>
            <Typography.Paragraph type="secondary">{ROLE_HELP[r.role]}</Typography.Paragraph>
            <Space wrap size={[4, 6]} style={{ marginBottom: 12 }}>
              {r.permissions.map((p) => <Tag key={p} color={GROUP_COLOR[PERMISSIONS[p]?.group ?? ''] ? undefined : 'default'} style={{ borderColor: GROUP_COLOR[PERMISSIONS[p]?.group ?? ''] }}>{PERMISSIONS[p]?.label ?? p}</Tag>)}
            </Space>
            <List size="small" dataSource={r.holders} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nobody has this role" /> }}
              renderItem={(h) => (
                <List.Item actions={manage ? [<Button key="x" size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${h.username}`}
                  data-testid={`role-remove-${h.username}`} onClick={() => void change(r.role, h.id, h.username, false)} />] : []}>
                  <List.Item.Meta avatar={<Avatar style={{ background: BRAND.ocean }}>{h.username.slice(0, 1).toUpperCase()}</Avatar>}
                    title={h.username} description={[h.firstName, h.lastName].filter(Boolean).join(' ') || (h.enabled ? '' : 'sign-in blocked')} />
                </List.Item>)} />
            {manage && (
              <AutoComplete style={{ width: '100%', marginTop: 12 }} value={query[r.role] ?? ''} placeholder="Add a person (type a username)"
                data-testid={`role-add-${r.role}`} onChange={(v) => search(r.role, v)}
                options={(options[r.role] ?? []).filter((o) => !r.holders.some((h) => h.id === o.user.id)).map((o) => ({ value: o.user.id, label: o.user.username }))}
                onSelect={(id: string) => { const u = options[r.role]?.find((o) => o.user.id === id); if (u) void change(r.role, id, u.user.username, true); }} />
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/** Roles on the left, permissions (grouped) on the right; click a role to highlight what it allows. */
function PermissionMap({ roles }: { roles: RoleView[] }) {
  const dark = useDark();
  const [focus, setFocus] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const perms = Object.entries(PERMISSIONS).sort((a, b) => a[1].group.localeCompare(b[1].group));
    const nodes: Node[] = [
      ...roles.map((r, i) => ({ id: r.role, position: { x: 0, y: 40 + i * 110 }, data: { label: `${ROLE_LABELS[r.role] ?? r.role} · ${r.holders.length}` },
        style: { width: 210, fontWeight: 600, border: `2px solid ${BRAND.ocean}`, borderRadius: 10, opacity: !focus || focus === r.role ? 1 : 0.35 },
        sourcePosition: 'right', targetPosition: 'left' } as Node)),
      ...perms.map(([p, meta], i) => ({ id: p, position: { x: 520, y: i * 46 }, data: { label: `${meta.label}` },
        style: { width: 300, fontSize: 12, borderRadius: 8, borderLeft: `5px solid ${GROUP_COLOR[meta.group]}`,
          opacity: !focus || roles.find((r) => r.role === focus)?.permissions.includes(p as never) ? 1 : 0.3 },
        sourcePosition: 'right', targetPosition: 'left' } as Node)),
    ];
    const edges: Edge[] = roles.flatMap((r) => r.permissions.map((p) => ({ id: `${r.role}-${p}`, source: r.role, target: p,
      animated: focus === r.role, style: { stroke: focus === r.role ? BRAND.ocean : dark ? '#3a404c' : '#cbd5e1', strokeWidth: focus === r.role ? 2 : 1, opacity: !focus || focus === r.role ? 1 : 0.15 },
      markerEnd: { type: MarkerType.ArrowClosed, color: focus === r.role ? BRAND.ocean : '#94a3b8' } })));
    return { nodes, edges };
  }, [roles, focus, dark]);
  return (
    <div data-testid="permission-map">
      <Space wrap style={{ marginBottom: 8 }}>
        {Object.entries(GROUP_COLOR).map(([g, c]) => <Tag key={g} style={{ borderLeft: `5px solid ${c}` }}>{g}</Tag>)}
        <Typography.Text type="secondary">Click a role to highlight its permissions; click the background to clear.</Typography.Text>
      </Space>
      <div style={{ height: 720 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setFocus(roles.some((r) => r.role === n.id) ? (focus === n.id ? null : n.id) : focus)} onPaneClick={() => setFocus(null)}>
          <Background gap={20} /><Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

/** The path every admin request takes: sign-in, permission check, action, audit. */
function AccessFlow() {
  const dark = useDark();
  const box = (bg: string) => ({ width: 220, borderRadius: 10, border: `2px solid ${bg}`, fontSize: 12, padding: 10 });
  const nodes: Node[] = [
    { id: 'admin', position: { x: 0, y: 140 }, data: { label: 'Administrator browser\nconvo-admin.doncik.ro' }, style: box(SERIES[2]) },
    { id: 'kc', position: { x: 300, y: 0 }, data: { label: 'Keycloak (Convo realm)\nsign-in + PKCE, passkey/2FA\nrealm role in the token' }, style: box(SERIES[3]) },
    { id: 'proxy', position: { x: 300, y: 160 }, data: { label: 'Console proxy\nonly /v1/admin + realm sign-in\nconsoles & messenger API: 404' }, style: box(BRAND.ocean) },
    { id: 'api', position: { x: 600, y: 160 }, data: { label: 'Admin API\nrole → permission check\nstep-up for credentials/roles\nno self-changes' }, style: box(BRAND.ocean) },
    { id: 'denied', position: { x: 600, y: 330 }, data: { label: 'Refused attempt\n(recorded in the audit chain)' }, style: box('#D14B4B') },
    { id: 'action', position: { x: 900, y: 60 }, data: { label: 'Action with a reason\naccounts · devices · recovery\nstatistics · health' }, style: box(SERIES[4]) },
    { id: 'ops', position: { x: 900, y: 220 }, data: { label: 'convo-admin-ops\nKeycloak users only\n(no realm admin)' }, style: box(SERIES[3]) },
    { id: 'audit', position: { x: 1200, y: 140 }, data: { label: 'Hash-chained audit log\n+ independent checkpoints' }, style: box(SERIES[0]) },
  ];
  const edge = (source: string, target: string, label: string, color = '#94a3b8'): Edge => ({ id: `${source}-${target}`, source, target, label, animated: true,
    style: { stroke: color }, labelStyle: { fontSize: 11 }, markerEnd: { type: MarkerType.ArrowClosed, color } });
  const edges = [edge('admin', 'kc', 'sign in'), edge('admin', 'proxy', 'token'), edge('proxy', 'api', '/v1/admin'),
    edge('api', 'denied', 'no permission', '#D14B4B'), edge('api', 'action', 'allowed', SERIES[4]), edge('api', 'ops', 'sign-in accounts', SERIES[3]),
    edge('action', 'audit', 'append'), edge('ops', 'audit', 'append')];
  return (
    <div style={{ height: 460 }} data-testid="access-flow">
      <ReactFlow nodes={nodes.map((n) => ({ ...n, data: { label: <div style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{n.data.label as string}</div> } }))}
        edges={edges} fitView colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={20} /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
