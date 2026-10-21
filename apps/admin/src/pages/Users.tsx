import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import { api, errorText, type AccountSummary } from '../api';
import { UserDrawer } from '../components/UserDrawer';
import { fmtDay, nameOf } from '../format';
import type { PageProps } from '../Shell';

/** Convo accounts (created at first sign-in): search, status, devices, last activity. */
export function UsersPage({ can, navigate, param }: PageProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [rows, setRows] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { void api.accounts(query).then(setRows).catch((e) => setError(errorText(e))); }, [query]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const shown = (rows ?? []).filter((r) => status === 'all' || r.status === status);
  return (
    <div data-testid="admin-users">
      <div className="page-head">
        <div><h1>Users</h1><p>Everyone who has signed in to Convo. Open a person to see their activity and devices, manage their sign-in, or handle a lost recovery kit.</p></div>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search allowClear placeholder="Search by name or handle" style={{ width: 320 }} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="admin-search" />
          <Segmented value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }, { label: 'Disabled', value: 'disabled' }]} />
          <Typography.Text type="secondary">{shown.length} people</Typography.Text>
        </Space>
        <Table rowKey="accountId" size="middle" loading={!rows} dataSource={shown} pagination={{ pageSize: 25, hideOnSinglePage: true }}
          rowClassName={() => 'clickable-row'} onRow={(r) => ({ onClick: () => navigate(`users/${r.accountId}`), 'data-testid': `admin-account-${r.username}` } as never)}
          columns={[
            { title: 'Name', key: 'name', render: (_, r) => <Space direction="vertical" size={0}><Typography.Text strong>{nameOf(r)}</Typography.Text><Typography.Text type="secondary">@{r.username}</Typography.Text></Space>,
              sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)) },
            { title: 'Status', dataIndex: 'status', width: 110, render: (s: string) => <Tag color={s === 'active' ? 'green' : 'red'} data-testid="admin-status">{s}</Tag> },
            { title: 'Devices', dataIndex: 'activeDevices', width: 90, align: 'right', render: (n: number) => <span data-testid="admin-devices">{n}</span>, sorter: (a, b) => a.activeDevices - b.activeDevices },
            { title: 'Last active', dataIndex: 'lastSeenDay', width: 150, render: fmtDay, sorter: (a, b) => (a.lastSeenDay ?? '').localeCompare(b.lastSeenDay ?? '') },
            { title: 'Joined', dataIndex: 'createdAt', width: 150, render: fmtDay, sorter: (a, b) => a.createdAt.localeCompare(b.createdAt) },
          ]} />
      </Card>
      <UserDrawer accountId={param || null} onClose={() => navigate('users')} can={can} onChanged={load} />
    </div>
  );
}
