import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { api, errorText, type AccountSummary, type SignInAccount } from '../api';
import { UserDrawer } from '../components/UserDrawer';
import { useViewState } from '../components/useViewState';
import { CreateUser } from '../components/CreateUser';
import { fmtDay, nameOf } from '../format';
import type { PageProps } from '../Shell';

interface Person { key: string; username: string; name: string; account?: AccountSummary; identity?: SignInAccount }

/** One directory for enrolled people and sign-in accounts still waiting to join. */
export function UsersPage({ can, navigate, param }: PageProps) {
  const { view, update, link } = useViewState({ search: '', status: 'all', page: '1', size: '25', sort: 'name-asc', drawerDays: '30', display: '' });
  const query = view.search, filter = view.status;
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [identities, setIdentities] = useState<SignInAccount[]>([]);
  const [busy, setBusy] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true); setErrors([]);
      void Promise.allSettled([api.accounts(query), api.idpUsers(query)]).then(([a, i]) => {
        if (!active) return;
        setAccounts(a.status === 'fulfilled' ? a.value : []);
        setIdentities(i.status === 'fulfilled' ? i.value : []);
        setErrors([a, i].flatMap((r, idx) => r.status === 'rejected' ? [`${idx ? 'Sign-in accounts' : 'Convo accounts'}: ${errorText(r.reason)}`] : []));
        setBusy(false);
      });
    }, 250);
  return () => { active = false; clearTimeout(timer); };
  }, [query, version]);
  const people = useMemo<Person[]>(() => {
    const matched = new Set<string>();
    const rows: Person[] = identities.map((identity) => {
      const account = accounts.find((a) => a.accountId === identity.convoAccountId);
      if (account) matched.add(account.accountId);
      const u = identity.user;
      return { key: `idp:${u.id}`, username: u.username, name: account ? nameOf(account) : [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username, account, identity };
    });
    return [...rows, ...accounts.filter((a) => !matched.has(a.accountId)).map((account) => ({ key: account.accountId, username: account.username, name: nameOf(account), account }))]
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, identities]);
  const shown = people.filter((p) => filter === 'all' || (filter === 'joined' && (p.account || p.identity?.convoAccountId)) || (filter === 'pending' && p.identity && !p.identity.convoAccountId)
    || (filter === 'blocked' && (p.account?.status === 'disabled' || p.identity?.user.enabled === false)));
  const open = (p: Person) => navigate(link(p.account ? `users/${p.account.accountId}` : p.identity?.convoAccountId ? `users/${p.identity.convoAccountId}` : `users/sign-in/${p.identity!.user.id}`));
  const parts = param.split('/');
  const identityId = parts[0] === 'sign-in' ? parts[1] ?? null : null;
  const accountId = !identityId && parts[0] ? parts[0] : null;
  const detailBase = identityId ? `users/sign-in/${identityId}` : `users/${accountId}`;
  const tab = (identityId ? parts[2] : parts[1]) || 'overview';
  const details = (accountId || identityId) ? <UserDrawer key={detailBase} accountId={accountId} subjectId={identityId} tab={tab} onTabChange={(key) => navigate(link(`${detailBase}/${key}`))} onClose={() => { update({ display: '' }, true); navigate(link('users')); }} expanded={view.display === 'page'} onMaximize={() => update({ display: view.display === 'page' ? '' : 'page' })} days={Number(view.drawerDays) || 30} onDaysChange={(days) => update({ drawerDays: String(days) })} can={can} onChanged={load} /> : null;
  if (details && view.display === 'page') return details;
  return (
    <div className="page-frame page-users" data-testid="admin-users">
      <div className="page-head">
        <div><div className="eyebrow">People & access</div><h1>Users</h1><p>One place for everyone: sign-in access, Convo activity, linked devices and people who have yet to join.</p></div>
        <Space><Button icon={<ReloadOutlined />} onClick={load} loading={busy}>Refresh</Button>{can('USERS_CREATE') && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreating(true)} data-testid="admin-create-user">Create user</Button>}</Space>
      </div>
      {errors.map((error) => <Alert key={error} type="warning" showIcon message={error} style={{ marginBottom: 16 }} />)}
      <Card className="table-surface">
        <div className="directory-toolbar">
          <Input.Search allowClear aria-label="Search users" placeholder="Search name, username or email" value={query} onChange={(e) => update({ search: e.target.value, page: '1' }, true)} data-testid="admin-search" />
          <Select aria-label="Filter users" value={filter} onChange={(status) => update({ status, page: '1' })} options={[{ value: 'all', label: 'Everyone' }, { value: 'joined', label: 'Joined Convo' }, { value: 'pending', label: 'Not joined yet' }, { value: 'blocked', label: 'Access restricted' }]} />
          <Select aria-label="Sort users" value={view.sort} onChange={(sort) => update({ sort, page: '1' })} options={[{ value: 'name-asc', label: 'Name · A to Z' }, { value: 'name-desc', label: 'Name · Z to A' }, { value: 'devices', label: 'Most devices' }, { value: 'last', label: 'Recently active' }]} />
          <Typography.Text type="secondary">{shown.length} results · up to 200 Convo / 100 sign-in accounts per search</Typography.Text>
        </div>
        <Table<Person> rowKey="key" size="middle" loading={busy} dataSource={[...shown].sort((a, b) => view.sort === 'devices' ? (b.account?.activeDevices ?? 0) - (a.account?.activeDevices ?? 0) : view.sort === 'last' ? (b.account?.lastSeenDay ?? '').localeCompare(a.account?.lastSeenDay ?? '') : a.name.localeCompare(b.name) * (view.sort === 'name-desc' ? -1 : 1))} scroll={{ x: 900, y: 1 }} pagination={{ current: Math.max(1, Number(view.page) || 1), pageSize: Math.max(1, Number(view.size) || 25), showSizeChanger: true, hideOnSinglePage: true, onChange: (page, size) => update({ page: String(page), size: String(size) }) }}
          rowClassName={() => 'clickable-row'} onRow={(p) => ({ onClick: () => open(p), 'data-testid': p.account ? `admin-account-${p.username}` : `idp-user-${p.username}` } as never)}
          columns={[
            { title: 'Person', key: 'person', render: (_, p) => <Space><Avatar>{p.name.slice(0, 1).toUpperCase()}</Avatar><Space direction="vertical" size={0}>
              <Button type="link" className="person-link" onClick={(e) => { e.stopPropagation(); open(p); }}>{p.name}</Button><Typography.Text type="secondary">@{p.username}</Typography.Text></Space></Space> },
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
