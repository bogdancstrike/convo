import { useEffect, useState } from 'react';
import { Alert, AutoComplete, Card, Col, Row, Segmented, Table, Tag, Typography } from 'antd';
import { api, errorText, type AccountSummary, type UserActivity } from '../api';
import { UserDrawer } from '../components/UserDrawer';
import { fmtDay, LEVEL, nameOf } from '../format';
import type { PageProps } from '../Shell';

/** Most and least active people, and a search to open anyone's activity. Counts only. */
export function ActivityPage({ can, navigate, param }: PageProps) {
  const [days, setDays] = useState(30);
  const [top, setTop] = useState<UserActivity[] | null>(null);
  const [quiet, setQuiet] = useState<UserActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<AccountSummary[]>([]);
  useEffect(() => {
    setTop(null); setQuiet(null);
    void api.usersByActivity('active', days, 10).then(setTop).catch((e) => setError(errorText(e)));
    void api.usersByActivity('inactive', days, 10).then(setQuiet).catch((e) => setError(errorText(e)));
  }, [days]);
  useEffect(() => { if (!search.trim()) { setOptions([]); return; } const t = setTimeout(() => void api.accounts(search).then((a) => setOptions(a.slice(0, 8))).catch(() => undefined), 200); return () => clearTimeout(t); }, [search]);
  const columns = [
    { title: 'Person', key: 'p', render: (_: unknown, r: UserActivity) => <><Typography.Text strong>{nameOf(r.account)}</Typography.Text> <Typography.Text type="secondary">@{r.account.username}</Typography.Text></> },
    { title: 'Level', key: 'l', width: 120, render: (_: unknown, r: UserActivity) => <Tag color={LEVEL[r.level].color}>{LEVEL[r.level].label}</Tag> },
    { title: 'Items', dataIndex: 'items', width: 80, align: 'right' as const },
    { title: 'Active days', key: 'd', width: 100, align: 'right' as const, render: (_: unknown, r: UserActivity) => `${r.activeDays} / ${days}` },
    { title: 'Last active', key: 'a', width: 130, render: (_: unknown, r: UserActivity) => fmtDay(r.lastActiveDay ?? r.account.lastSeenDay) },
  ];
  const open = (r: UserActivity) => ({ onClick: () => navigate(`activity/${r.account.accountId}`), className: 'clickable-row' });
  return (
    <div data-testid="admin-activity">
      <div className="page-head">
        <div><h1>Activity</h1><p>Who uses Convo and who may need help getting started. Levels come from the share of active days; items are encrypted items sent (messages, receipts, reactions…).</p></div>
        <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }]} />
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Card style={{ marginBottom: 16 }}>
        <AutoComplete style={{ width: 380 }} value={search} onChange={setSearch} placeholder="Find a person to see their activity" data-testid="activity-search"
          options={options.map((a) => ({ value: a.accountId, label: `${nameOf(a)} (@${a.username})` }))}
          onSelect={(id: string) => { setSearch(''); navigate(`activity/${id}`); }} />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}><Card title="Most active" data-testid="activity-top">
          <Table rowKey={(r) => r.account.accountId} size="small" loading={!top} dataSource={top ?? []} pagination={false} columns={columns} onRow={open} /></Card></Col>
        <Col xs={24} xl={12}><Card title="Least active" extra={<Typography.Text type="secondary">never or longest ago first</Typography.Text>} data-testid="activity-quiet">
          <Table rowKey={(r) => r.account.accountId} size="small" loading={!quiet} dataSource={quiet ?? []} pagination={false} columns={columns} onRow={open} /></Card></Col>
      </Row>
      <UserDrawer accountId={param || null} onClose={() => navigate('activity')} can={can} />
    </div>
  );
}
