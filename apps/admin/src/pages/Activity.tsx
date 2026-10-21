import { useEffect, useState } from 'react';
import { Alert, AutoComplete, Card, Col, Row, Segmented, Skeleton, Statistic, Table, Tag, Typography } from 'antd';
import { Chart } from '../components/Chart';
import { SERIES } from '../theme';
import { api, errorText, type AccountSummary, type Levels, type Overview, type UserActivity } from '../api';
import { UserDrawer } from '../components/UserDrawer';
import { fmtDay, LEVEL, nameOf, shortDay } from '../format';
import type { PageProps } from '../Shell';

/** Most and least active people, and a search to open anyone's activity. Counts only. */
export function ActivityPage({ can, navigate, param }: PageProps) {
  const [days, setDays] = useState(30);
  const [top, setTop] = useState<UserActivity[] | null>(null);
  const [quiet, setQuiet] = useState<UserActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<AccountSummary[]>([]);
  const [levels, setLevels] = useState<Levels | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    setLevels(null); setOverview(null);
    void api.levels(days).then(setLevels).catch((e) => setError(errorText(e)));
    void api.overview(days).then(setOverview).catch((e) => setError(errorText(e)));
  }, [days]);
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
      <ActivityStats days={days} levels={levels} overview={overview} />
      <Card style={{ marginBottom: 16 }}>
        <AutoComplete style={{ width: 380 }} value={search} onChange={setSearch} placeholder="Find a person to see their activity" data-testid="activity-search"
          options={options.map((a) => ({ value: a.accountId, label: `${nameOf(a)} (@${a.username})` }))}
          onSelect={(id: string) => { setSearch(''); navigate(`activity/${id}`); }} />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}><Card title="Most active" data-testid="activity-top">
          <Table rowKey={(r) => r.account.accountId} loading={!top} dataSource={top ?? []} pagination={false} columns={columns} onRow={open} /></Card></Col>
        <Col xs={24} xl={12}><Card title="Least active" extra={<Typography.Text type="secondary">never or longest ago first</Typography.Text>} data-testid="activity-quiet">
          <Table rowKey={(r) => r.account.accountId} loading={!quiet} dataSource={quiet ?? []} pagination={false} columns={columns} onRow={open} /></Card></Col>
      </Row>
      <UserDrawer accountId={param || null} onClose={() => navigate('activity')} can={can} />
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Activity KPIs and charts: levels, active people per day, and items by weekday. */
function ActivityStats({ days, levels, overview }: { days: number; levels: Levels | null; overview: Overview | null }) {
  const active = levels ? levels.high + levels.medium + levels.low : 0;
  const total = levels ? active + levels.none : 0;
  const items = overview?.days.reduce((n, d) => n + d.items, 0) ?? 0;
  const peak = overview?.days.reduce((m, d) => Math.max(m, d.activeAccounts), 0) ?? 0;
  const byWeekday = WEEKDAYS.map((_, i) => overview?.days.filter((d) => (new Date(d.day).getUTCDay() + 6) % 7 === i).reduce((n, d) => n + d.items, 0) ?? 0);
  const kpis = [
    { title: `Active · ${days} d`, value: active, suffix: total ? `/ ${total}` : '', testId: 'activity-kpi-active' },
    { title: 'Adoption', value: total ? Math.round((active / total) * 100) : 0, suffix: '%', testId: 'activity-kpi-adoption' },
    { title: 'Very active', value: levels?.high ?? 0, suffix: 'people', testId: 'activity-kpi-high' },
    { title: 'Peak active in a day', value: peak, suffix: 'people', testId: 'activity-kpi-peak' },
    { title: 'Items per active person', value: active ? Math.round(items / active) : 0, suffix: `in ${days} d`, testId: 'activity-kpi-items' },
    { title: 'Inactive', value: levels?.none ?? 0, suffix: 'people', testId: 'activity-kpi-inactive' },
  ];
  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {kpis.map((k) => (
        <Col key={k.title} xs={24} sm={12} xl={4}>
          <Card className="kpi" data-testid={k.testId}>{levels && overview ? <Statistic title={k.title} value={k.value} suffix={<span style={{ fontSize: 14, opacity: 0.6 }}>{k.suffix}</span>} /> : <Skeleton active paragraph={false} />}</Card>
        </Col>
      ))}
      <Col xs={24} xl={8}>
        <Card title="Activity levels" extra={<Typography.Text type="secondary">share of active days</Typography.Text>}>
          {levels ? <Chart label="People by activity level" height={260} option={{
            tooltip: { trigger: 'item' }, legend: { bottom: 0, top: 'auto' },
            series: [{ type: 'pie', radius: ['45%', '72%'], label: { show: false }, itemStyle: { borderRadius: 6, borderWidth: 2 },
              data: [
                { name: LEVEL.high.label, value: levels.high, itemStyle: { color: '#2E9D6A' } },
                { name: LEVEL.medium.label, value: levels.medium, itemStyle: { color: SERIES[0] } },
                { name: LEVEL.low.label, value: levels.low, itemStyle: { color: '#F2B66D' } },
                { name: LEVEL.none.label, value: levels.none, itemStyle: { color: '#94a3b8' } },
              ] }],
          }} /> : <Skeleton active />}
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card title="People using Convo per day" extra={<Typography.Text type="secondary">sent something vs only opened</Typography.Text>}>
          {overview ? <Chart label="People using Convo per day, split into senders and readers" height={260} option={{
            xAxis: { type: 'category', data: overview.days.map((d) => shortDay(d.day)), boundaryGap: false }, yAxis: { type: 'value', minInterval: 1 },
            series: [
              { name: 'Sent something', type: 'line', stack: 'people', smooth: true, showSymbol: false, areaStyle: { opacity: 0.35 }, data: overview.days.map((d) => d.senders) },
              { name: 'Only opened', type: 'line', stack: 'people', smooth: true, showSymbol: false, areaStyle: { opacity: 0.2 }, data: overview.days.map((d) => Math.max(0, d.activeAccounts - d.senders)) },
            ],
          }} /> : <Skeleton active />}
        </Card>
      </Col>
      <Col xs={24} xl={6}>
        <Card title="By weekday" extra={<Typography.Text type="secondary">encrypted items</Typography.Text>}>
          {overview ? <Chart label="Encrypted items by weekday" height={260} option={{
            xAxis: { type: 'category', data: WEEKDAYS }, yAxis: { type: 'value', minInterval: 1 },
            series: [{ name: 'Items', type: 'bar', barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0], color: SERIES[2] }, data: byWeekday }],
          }} /> : <Skeleton active />}
        </Card>
      </Col>
      <Col xs={24} xl={16}>
        <Card title="Web and Android" extra={<Typography.Text type="secondary">people per day on each platform</Typography.Text>}>
          {overview ? <Chart label="People per day on web and Android" height={240} option={{
            xAxis: { type: 'category', data: overview.days.map((d) => shortDay(d.day)) }, yAxis: { type: 'value', minInterval: 1 },
            series: [
              { name: 'Web', type: 'bar', barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0] }, data: overview.days.map((d) => d.webUsers) },
              { name: 'Android', type: 'bar', barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0], color: SERIES[4] }, data: overview.days.map((d) => d.androidUsers) },
            ],
          }} /> : <Skeleton active />}
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card title="Platform share" extra={<Typography.Text type="secondary">person-days in the period</Typography.Text>}>
          {overview ? <Chart label="Share of usage by platform" height={240} option={{
            tooltip: { trigger: 'item' }, legend: { bottom: 0, top: 'auto' },
            series: [{ type: 'pie', radius: ['45%', '72%'], label: { show: false }, itemStyle: { borderRadius: 6, borderWidth: 2 }, data: [
              { name: 'Web', value: overview.days.reduce((n, d) => n + d.webUsers, 0), itemStyle: { color: SERIES[0] } },
              { name: 'Android', value: overview.days.reduce((n, d) => n + d.androidUsers, 0), itemStyle: { color: SERIES[4] } },
            ] }],
          }} /> : <Skeleton active />}
        </Card>
      </Col>
    </Row>
  );
}
