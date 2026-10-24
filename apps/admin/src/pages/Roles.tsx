import { useCallback, useEffect, useState } from 'react';
import { Alert, App, AutoComplete, Avatar, Button, Card, Col, Collapse, Empty, Input, Row, Select, Popover, Space, Tabs, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, UserAddOutlined } from '@ant-design/icons';
import '@xyflow/react/dist/style.css';
import { api, errorText, type RoleView, type SignInAccount } from '../api';
import { useReason } from '../components/confirm';
import { PERMISSIONS, ROLE_LABELS } from '../format';
import { BRAND, SERIES } from '../theme';
import { PermissionMap } from '../components/PermissionMap';
import { AccessFlow } from '../components/AccessFlow';
import { useViewState } from '../components/useViewState';
import { RoleOrgChart } from '../components/RoleOrgChart';
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
export function RolesPage({ can, navigate }: PageProps) {
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); void api.roles().then(setRoles).catch((e) => setError(errorText(e))); }, []);
  const { view, update } = useViewState({ tab: 'roles', role: 'convo-admin', holderSearch: '', holderStatus: 'all', holderPage: '1', holderSize: '20', holderSort: 'name-asc', chartRole: 'all', chartSearch: '', chartNode: '', chartPage: '1', permission: '', accessNode: '' });
  const selected = view.role;
  useEffect(load, [load]);
  return (
    <div className="page-frame page-roles" data-testid="admin-roles-page">
      <div className="page-head">
        <div><h1>Roles &amp; permissions</h1><p>Administrator roles at the organization's sign-in service. Explore who has access, compare permissions, and manage assignments from one place.</p></div>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <div className="role-summary">
        <div><strong>{roles?.length ?? '—'}</strong><span>Administrator roles</span></div>
        <div><strong>{roles ? new Set(roles.flatMap((r) => r.holders.map((h) => h.id))).size : '—'}</strong><span>People with access</span></div>
        <div><strong>{Object.keys(PERMISSIONS).length}</strong><span>Scoped permissions</span></div>
        <Typography.Text type="secondary">Roles are additive. A person with several roles receives their combined permissions.</Typography.Text>
      </div>
      <Tabs activeKey={view.tab} onChange={(tab) => update({ tab })} items={[
        { key: 'roles', label: 'Role explorer', children: <div className="role-explorer">
          <nav aria-label="Administrator roles" className="role-nav">{(roles ?? []).map((r) => <button key={r.role} type="button" aria-pressed={selected === r.role} onClick={() => update({ role: r.role, holderPage: '1' })}>
            <span>{ROLE_LABELS[r.role] ?? r.role}</span><Tag>{r.holders.length}</Tag><small>{r.permissions.length} permissions</small>
          </button>)}</nav>
          <div><RoleCards roles={roles?.filter((r) => r.role === selected) ?? null} can={can} onChanged={load} view={view} update={update} onPerson={(id) => navigate(`users/sign-in/${id}`)} /></div>
        </div> },
        { key: 'organization', label: 'Organization chart', children: <RoleOrgChart roles={roles ?? []} view={view} update={update} canManage={can('ROLES_MANAGE')} onPerson={(id, tab) => navigate(`users/sign-in/${id}${tab ? `/${tab}` : ''}`)} onRole={(role) => update({ role, tab: 'roles', holderPage: '1' })} /> },
        { key: 'compare', label: 'Compare permissions', children: <Card className="scroll-surface"><Typography.Paragraph type="secondary">Compare exactly which permissions each role grants. Assignments are independent.</Typography.Paragraph>
          <Table rowKey="key" pagination={false} scroll={{ x: 1000 }} size="middle" dataSource={Object.entries(PERMISSIONS).map(([key, meta]) => ({ key, ...meta }))}
            columns={[{ title: 'Permission', dataIndex: 'label', fixed: 'left', width: 300, render: (label: string, row) => <><Typography.Text strong>{label}</Typography.Text><br /><Typography.Text type="secondary">{row.group}</Typography.Text></> },
              ...(roles ?? []).map((r) => ({ title: ROLE_LABELS[r.role] ?? r.role, key: r.role, align: 'center' as const, render: (_: unknown, row: { key: string }) => r.permissions.includes(row.key as never) ? <Tag color="green">Allowed</Tag> : <span aria-label="Not granted">—</span> }))]} />
        </Card> },
        { key: 'map', label: 'Permission map', children: <Card className="diagram-surface"><PermissionMap roles={roles ?? []} focus={view.permission} onFocus={(permission) => update({ permission })} /></Card> },
        { key: 'flow', label: 'How access works', children: <Card className="diagram-surface"><AccessFlow selected={view.accessNode} onSelect={(accessNode) => update({ accessNode }, !accessNode)} /></Card> },
      ]} />
    </div>
  );
}

interface HolderView { holderSearch: string; holderStatus: string; holderPage: string; holderSize: string; holderSort: string }
function RoleCards({ roles, can, onChanged, view, update, onPerson }: {
  roles: RoleView[] | null; can: PageProps['can']; onChanged: () => void; view: HolderView;
  update: (patch: Partial<HolderView>, replace?: boolean) => void; onPerson: (id: string) => void;
}) {
  const { message } = App.useApp();
  const ask = useReason();
  const [query, setQuery] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, SignInAccount[]>>({});
  const manage = can('ROLES_MANAGE');
  const search = (role: string, q: string) => {
    setQuery((s) => ({ ...s, [role]: q }));
    if (q.trim().length < 2) { setOptions((s) => ({ ...s, [role]: [] })); return; }
    void api.idpUsers(q).then((u) => setOptions((s) => ({ ...s, [role]: u.slice(0, 8) }))).catch(() => undefined);
  };
  const change = async (role: string, id: string, username: string, grant: boolean) => {
    const label = ROLE_LABELS[role] ?? role;
    const reason = await ask(grant ? `Grant ${label} to ${username}` : `Remove ${label} from ${username}`,
      grant ? 'Takes effect when their access token renews or they sign in again.' : 'Takes effect when their access token renews or they sign in again.', grant);
    if (!reason) return;
    try { await api.setRole(id, role, grant, reason); message.success(grant ? 'Role granted' : 'Role removed'); setQuery((s) => ({ ...s, [role]: '' })); onChanged(); }
    catch (e) { message.error(errorText(e)); }
  };
  if (!roles) return <Card loading />;
  return (
    <Row gutter={[16, 16]}>
      {roles.map((r) => (
        <Col key={r.role} span={24}>
          <Card title={<Space>{ROLE_LABELS[r.role] ?? r.role}<Tag>{r.holders.length}</Tag></Space>} data-testid={`role-card-${r.role}`}
            extra={<Typography.Text type="secondary" code>{r.role}</Typography.Text>}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{ROLE_HELP[r.role]}</Typography.Paragraph>
            <Collapse ghost size="small" className="role-permission-disclosure" items={[{ key: 'permissions', label: `View ${r.permissions.length} permissions across ${new Set(r.permissions.map((p) => PERMISSIONS[p]?.group)).size} areas`, children: <div className="permission-groups">{Object.entries(GROUP_COLOR).map(([group, color]) => {
              const permissions = r.permissions.filter((p) => PERMISSIONS[p]?.group === group);
              return permissions.length ? <div key={group}><Typography.Text className="permission-group-name" type="secondary">{group}</Typography.Text><Space wrap size={[4, 6]}>
                {permissions.map((p) => <Tag key={p} style={{ borderInlineStart: `3px solid ${color}` }}>{PERMISSIONS[p]?.label ?? p}</Tag>)}
              </Space></div> : null;
            })}</div> }]} />
            <div className="directory-toolbar">
              {manage && <Popover trigger="click" title={`Grant ${ROLE_LABELS[r.role] ?? r.role}`} content={<AutoComplete style={{ width: 300, maxWidth: '100%' }} value={query[r.role] ?? ''} aria-label="Assign this role to a person" placeholder="Grant this role: search by username"
                data-testid={`role-add-${r.role}`} onChange={(v) => search(r.role, v)}
                options={(options[r.role] ?? []).filter((o) => !r.holders.some((h) => h.id === o.user.id)).map((o) => ({ value: o.user.id, label: o.user.username }))}
                onSelect={(id: string) => { const u = options[r.role]?.find((o) => o.user.id === id); if (u) void change(r.role, id, u.user.username, true); }} />}><Button icon={<UserAddOutlined />}>Assign person</Button></Popover>}
              <Input.Search allowClear aria-label="Search people in selected role" placeholder="Search name or username" value={view.holderSearch} onChange={(e) => update({ holderSearch: e.target.value, holderPage: '1' }, true)} />
              <Select aria-label="Filter role holders by sign-in status" style={{ minWidth: 150 }} value={view.holderStatus} onChange={(holderStatus) => update({ holderStatus, holderPage: '1' })} options={[{ value: 'all', label: 'All sign-in statuses' }, { value: 'allowed', label: 'Sign-in allowed' }, { value: 'blocked', label: 'Sign-in blocked' }]} />
              <Select aria-label="Sort role holders" style={{ minWidth: 140 }} value={view.holderSort} onChange={(holderSort) => update({ holderSort, holderPage: '1' })} options={[{ value: 'name-asc', label: 'Name · A to Z' }, { value: 'name-desc', label: 'Name · Z to A' }, { value: 'username', label: 'Username · A to Z' }]} />
            </div>
            <Table rowKey="id" size="middle" scroll={{ x: 440, y: 'max(300px, calc(100vh - 410px))' }} data-testid="role-holders-table" locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={r.holders.length ? 'No people match these filters' : 'No people assigned yet'} /> }}
              dataSource={r.holders.filter((h) => `${h.username} ${h.firstName ?? ''} ${h.lastName ?? ''}`.toLowerCase().includes(view.holderSearch.toLowerCase()) && (view.holderStatus === 'all' || h.enabled === (view.holderStatus === 'allowed')))
                .sort((a, b) => view.holderSort === 'username' ? a.username.localeCompare(b.username) : `${a.firstName ?? ''} ${a.lastName ?? ''} ${a.username}`.localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''} ${b.username}`) * (view.holderSort === 'name-desc' ? -1 : 1))}
              pagination={{ current: Math.max(1, Number(view.holderPage) || 1), pageSize: Math.max(1, Number(view.holderSize) || 20), pageSizeOptions: [20, 50, 100], showSizeChanger: true, showTotal: (total) => `${total} matching people`, onChange: (page, size) => update({ holderPage: String(page), holderSize: String(size) }) }}
              columns={[
                { title: 'Person', key: 'person', render: (_, h) => <Space><Avatar style={{ background: BRAND.ocean }}>{h.username.slice(0, 1).toUpperCase()}</Avatar><Space direction="vertical" size={0}>
                  <Button type="link" className="person-link" onClick={() => onPerson(h.id)}>{[h.firstName, h.lastName].filter(Boolean).join(' ') || h.username}</Button><Typography.Text type="secondary">@{h.username}</Typography.Text></Space></Space> },
                { title: 'Sign-in', key: 'status', width: 130, render: (_, h) => <Tag color={h.enabled ? 'green' : 'red'}>{h.enabled ? 'Allowed' : 'Blocked'}</Tag> },
                ...(manage ? [{ title: 'Actions', key: 'actions', width: 110, render: (_: unknown, h: RoleView['holders'][number]) => <Button size="small" danger type="text" icon={<DeleteOutlined />} aria-label={`Remove ${h.username}`} data-testid={`role-remove-${h.username}`} onClick={() => void change(r.role, h.id, h.username, false)}>Remove</Button> }] : []),
              ]} />
            {r.holders.length >= 500 && <Typography.Paragraph type="secondary">Showing the first 500 role holders returned by the sign-in service.</Typography.Paragraph>}

          </Card>
        </Col>
      ))}
    </Row>
  );
}
