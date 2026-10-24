import { useCallback, useState } from 'react';
import { Avatar, Button, Card, Select, Space, Tag, Typography } from 'antd';
import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { type AccountSummary, type SignInAccount } from '../api';
import { UserDrawer } from '../components/UserDrawer';
import { useViewState } from '../components/useViewState';
import { AdminTable } from '../components/AdminTable';
import { CreateUser } from '../components/CreateUser';
import { fmtDay } from '../format';
import type { PageProps } from '../Shell';

interface Person { key: string; username: string; name: string; account?: AccountSummary; identity?: SignInAccount }

/** One directory for enrolled people and sign-in accounts still waiting to join. */
export function UsersPage({ can, navigate, param }: PageProps) {
  const { view, update, link } = useViewState({ search: '', status: 'all', page: '1', size: '25', sort: 'name-asc', drawerDays: '30', display: '', graphNode: '' });
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  const open = (p: Person) => navigate(link(p.account ? `users/${p.account.accountId}` : p.identity?.convoAccountId ? `users/${p.identity.convoAccountId}` : `users/sign-in/${p.identity!.user.id}`));
  const parts = param.split('/');
  const identityId = parts[0] === 'sign-in' ? parts[1] ?? null : null;
  const accountId = !identityId && parts[0] ? parts[0] : null;
  const detailBase = identityId ? `users/sign-in/${identityId}` : `users/${accountId}`;
  const tab = (identityId ? parts[2] : parts[1]) || 'overview';
  const details = (accountId || identityId) ? <UserDrawer key={detailBase} accountId={accountId} subjectId={identityId} tab={tab} onTabChange={(key) => navigate(link(`${detailBase}/${key}`))} onClose={() => { update({ display: '' }, true); navigate(link('users')); }} graphNode={view.graphNode} onGraphNodeChange={(graphNode) => update({ graphNode }, !graphNode)} expanded={view.display === 'page'} onMaximize={() => update({ display: view.display === 'page' ? '' : 'page' })} days={Number(view.drawerDays) || 30} onDaysChange={(days) => update({ drawerDays: String(days) })} can={can} onChanged={load} /> : null;
  if (details && view.display === 'page') return details;
  return (
    <div className="page-frame page-users" data-testid="admin-users">
      <div className="page-head">
        <div><div className="eyebrow">People & access</div><h1>Users</h1><p>One place for everyone: sign-in access, Convo activity, linked devices and people who have yet to join.</p></div>
        <Space><Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>{can('USERS_CREATE') && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreating(true)} data-testid="admin-create-user">Create user</Button>}</Space>
      </div>
      <Card className="table-surface">
        <AdminTable<Person> id="people" resource="people" rowKey="key" scope={{ status: view.status }} defaultSort="name" defaultSize={25} refreshKey={version} searchId="admin-search" searchPlaceholder="Search name, username or email"
          controls={<Select aria-label="Filter users" value={view.status} onChange={(status) => update({ status })} options={[{ value: 'all', label: 'Everyone' }, { value: 'joined', label: 'Joined Convo' }, { value: 'pending', label: 'Not joined yet' }, { value: 'blocked', label: 'Access restricted' }]} style={{ width: 170 }} />}
          onRow={(p) => ({ onClick: () => open(p), 'data-testid': p.account ? `admin-account-${p.username}` : `idp-user-${p.username}` } as never)}
          columns={[
            { title: 'Person', key: 'person', render: (_, p) => <div className="table-person-cell"><Avatar>{p.name.slice(0, 1).toUpperCase()}</Avatar><div>
              <Button type="link" className="person-link" title={p.name} onClick={(e) => { e.stopPropagation(); open(p); }}>{p.name}</Button><Typography.Text type="secondary" title={`@${p.username}`}>@{p.username}</Typography.Text></div></div> },
            { title: 'Convo', key: 'convo', render: (_, p) => p.account ? <Tag color={p.account.status === 'active' ? 'green' : 'red'} data-testid="admin-status">{p.account.status}</Tag> : <Tag>{p.identity?.convoAccountId ? 'Joined' : 'Not joined yet'}</Tag> },
            { title: 'Sign-in access', key: 'signin', render: (_, p) => p.identity ? <Space direction="vertical" size={2}><Tag color={p.identity.user.enabled ? 'blue' : 'red'}>{p.identity.user.enabled ? 'Allowed' : 'Blocked'}</Tag>

              {!!p.identity.user.requiredActions.length && <Typography.Text type="secondary">{p.identity.user.requiredActions.length} setup steps pending</Typography.Text>}</Space> : <Typography.Text type="secondary">Unavailable</Typography.Text> },
            { title: 'Devices', key: 'devices', align: 'right', render: (_, p) => <span data-testid="admin-devices">{p.account?.activeDevices ?? '—'}</span> },
            { title: 'Last active', key: 'last', render: (_, p) => fmtDay(p.account?.lastSeenDay) },
            { title: 'Created', key: 'created', render: (_, p) => fmtDay(p.identity?.user.createdAt ?? p.account?.createdAt) },
          ]} />
      </Card>
      {details}
      {can('USERS_CREATE') && <CreateUser open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); navigate(link(`users/sign-in/${id}`)); }} />}
    </div>
  );
}
