import dayjs from 'dayjs';
import { ChartCard } from '../components/ChartCard';
import { useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Col, DatePicker, Row, Segmented, Skeleton, Statistic, Tabs, Tag, Typography } from 'antd';
import { api, errorText, type AccountActivity, type AccountSummary, type Levels, type Overview, type UserActivity } from '../api';
import { Chart } from '../components/Chart';
import { useViewState } from '../components/useViewState';
import { ThroughputChart } from '../components/ThroughputChart';
import { AdminTable } from '../components/AdminTable';
import { ActivityStats } from '../components/ActivityStats';
import { compact, fmtDay, LEVEL, nameOf, shortDay } from '../format';
import { SERIES } from '../theme';
import type { PageProps } from '../Shell';

/** Shared date window and person scope for all metrics on this page. */
export function OverviewPage({ can, navigate, param }: PageProps) {
  const { view, update, link } = useViewState({ days: '30', tab: 'trends', personQuery: '', throughput: '60', from: '', to: '' });
  const today = new Date().toISOString().slice(0, 10);
  const custom = view.days === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(view.from) && /^\d{4}-\d{2}-\d{2}$/.test(view.to);
  const days = custom ? Math.max(1, dayjs(view.to).diff(dayjs(view.from), 'day') + 1) : [1, 7, 30, 90].includes(Number(view.days)) ? Number(view.days) : 30;
  const range = { from: custom ? view.from : dayjs(today).subtract(days - 1, 'day').format('YYYY-MM-DD'), to: custom ? view.to : today };
  const dateLabel = custom ? `${dayjs(range.from).format('D MMM YYYY')} – ${dayjs(range.to).format('D MMM YYYY')} · UTC` : `Last ${days} ${days === 1 ? 'day' : 'days'} · UTC`;
  const [data, setData] = useState<Overview | null>(null);
  const [person, setPerson] = useState<AccountActivity | null>(null);
  const [levels, setLevels] = useState<Levels | null>(null);
  const query = view.personQuery;
  const [options, setOptions] = useState<AccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const selected = can('ACCOUNTS_READ') ? param : '';
  useEffect(() => {
    let active = true;
    setBusy(true); setError(null); setPerson(null); setData(null); setLevels(null);
    if (selected) {
      void api.accountActivity(selected, days, range).then((v) => { if (active) setPerson(v); }).catch((e) => { if (active) setError(errorText(e)); }).finally(() => { if (active) setBusy(false); });
    } else {
      void Promise.all([api.overview(days, range), api.levels(days, range)]).then(([o, l]) => { if (active) { setData(o); setLevels(l); } }).catch((e) => { if (active) setError(errorText(e)); }).finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, [days, range.from, range.to, selected, can]);
  useEffect(() => {
    let active = true;
    if (!can('ACCOUNTS_READ')) return;
    const timer = setTimeout(() => void api.accounts(query).then((v) => { if (active) setOptions(v); }).catch(() => { if (active) setOptions([]); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, can]);
  const rankings = (mode: string) => <AdminTable<UserActivity> id={`activity-${mode}`} resource="activity" rowKey={(r) => r.account.accountId} scope={{ days: String(days), from: range.from, to: range.to }} defaultSort="items" defaultOrder={mode === 'active' ? 'desc' : 'asc'} defaultSize={10} columns={[
    { title: 'Person', key: 'person', render: (_, r) => <Button type="link" className="person-link" onClick={() => navigate(link(`overview/${r.account.accountId}`))}>{nameOf(r.account)}</Button> },
    { title: 'Level', key: 'level', render: (_, r) => <Tag color={LEVEL[r.level].color}>{LEVEL[r.level].label}</Tag> },
    { title: 'Items', key: 'items', dataIndex: 'items', align: 'right' }, { title: 'Days used', key: 'activeDays', dataIndex: 'activeDays', align: 'right' },
    { title: 'Last active', key: 'last', render: (_, r) => fmtDay(r.lastActiveDay) },
  ]} />;

  return <div className="page-frame page-overview" data-testid="admin-overview">
    <div className="page-head"><div><div className="eyebrow">Usage & adoption</div><h1>Overview &amp; activity</h1><p>Follow adoption across your organization or focus on one person's activity. Counts only; message content stays private.</p></div>
      </div>
    <Card className="scope-bar" size="small"><div className="scope-controls"><Tag color="blue">{selected ? 'Individual activity' : 'Entire organization'}</Tag>
      {can('ACCOUNTS_READ') && <AutoComplete className="person-picker" popupClassName="activity-picker-popup" popupMatchSelectWidth={false} value={query} onChange={(personQuery) => update({ personQuery }, true)} placeholder={person ? `${nameOf(person.summary.account)} (@${person.summary.account.username})` : 'Select a person or search by name'}
        aria-label="Select user activity" data-testid="activity-search" options={options.map((a) => ({ value: a.accountId, label: `${nameOf(a)} (@${a.username})` }))}
        onSelect={(id: string) => { update({ personQuery: '', throughput: '60', from: '', to: '' }, true); navigate(link(`overview/${id}`)); }} />}
      {!!selected && <Button onClick={() => { update({ personQuery: '', throughput: '60', from: '', to: '' }, true); navigate(link('overview')); }}>All users</Button>}
      {person && <Button onClick={() => navigate(`users/${person.summary.account.accountId}`)}>Open user profile</Button>}
      <div className="scope-date-controls"><div className="scope-date-presets"><Typography.Text type="secondary">{dateLabel}</Typography.Text><Segmented aria-label="Activity date window" value={custom || view.days === 'custom' || view.days === '90' ? 'custom' : String(days)} onChange={(v) => v === 'custom' ? update({ days: 'custom', from: range.from, to: range.to }) : update({ days: String(v), from: '', to: '' })} options={[{ value: '1', label: '1d' }, { value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: 'custom', label: 'Custom' }]} data-testid="overview-window" /></div>{(custom || view.days === 'custom' || view.days === '90') && <DatePicker.RangePicker aria-label="Custom activity date range" allowClear={false} value={[dayjs(range.from), dayjs(range.to)]} format="YYYY-MM-DD" placeholder={['Start date', 'End date']} disabledDate={(date) => date.isAfter(dayjs(today), 'day')} onChange={(dates) => { if (dates?.[0] && dates[1]) update({ days: 'custom', from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') }); }} />}</div>
    </div></Card>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    {busy ? <Card><Skeleton active /></Card> : selected ? person && <PersonActivity person={person} /> : data && <>
      {!data.activityTracking && <Alert type="info" showIcon message="Activity tracking is turned off for this deployment." style={{ marginBottom: 16 }} />}
<Tabs activeKey={view.tab === 'throughput' ? 'trends' : view.tab} onChange={(tab) => update({ tab })} items={[
        { key: 'trends', label: 'Usage trends', children: <OrganizationOverview days={days} data={data} throughput={<ThroughputChart range={range} />} /> },
        { key: 'adoption', label: 'Adoption & engagement', children: <ActivityStats days={days} levels={levels} overview={data} /> },
        ...(can('ACCOUNTS_READ') ? [{ key: 'people', label: 'People', children: <>
          <div className="people-activity-panels"><Row gutter={[16, 16]}><Col xs={24} xl={12}><Card className="activity-table-card" title="Most active" data-testid="activity-top">{rankings('active')}</Card></Col><Col xs={24} xl={12}><Card className="activity-table-card" title="Least active" data-testid="activity-quiet">{rankings('inactive')}</Card></Col></Row><NewPeople data={data} /></div>
        </> }] : []),
      ]} />
    </>}
  </div>;
}

function PersonActivity({ person }: { person: AccountActivity }) {
  const { account, items, activeDays, lastActiveDay, level } = person.summary;
  const byDay = new Map(person.days.map((d) => [d.day, d]));
  const today = person.to ?? new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: person.window }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - (person.window - 1 - i) * 86400000).toISOString().slice(0, 10));
  const metrics = [
    { label: 'Encrypted items', value: items }, { label: 'Days used', value: activeDays, suffix: `/ ${person.window}` },
    { label: 'Days with items sent', value: person.days.filter((d) => d.items > 0).length },
    { label: 'Web activity', value: person.days.filter((d) => d.web).length, suffix: 'days' },
    { label: 'Android activity', value: person.days.filter((d) => d.android).length, suffix: 'days' },
    { label: 'Last active', value: fmtDay(lastActiveDay) },
  ];
  return <div data-testid="person-activity"><div className="section-heading"><h2>{nameOf(account)} <Typography.Text type="secondary">@{account.username}</Typography.Text></h2><Tag color={LEVEL[level].color}>{LEVEL[level].label}</Tag></div>
    <Row gutter={[16, 16]}>{metrics.map((m) => <Col key={m.label} xs={24} sm={12} xl={4}><Card className="kpi"><Statistic title={m.label} value={m.value} suffix={m.suffix} valueStyle={typeof m.value === 'string' ? { fontSize: 20 } : undefined} /></Card></Col>)}
      <Col span={24}><ChartCard title="Daily activity" description={<>{person.window} days · UTC</>}><Chart label={`Daily activity of ${account.username}`} option={{
        xAxis: { type: 'category', data: dates.map(shortDay) }, yAxis: [{ type: 'value', name: 'items', minInterval: 1 }, { type: 'value', min: 0, max: 1, show: false }],
        series: [{ name: 'Encrypted items', type: 'bar', barMaxWidth: 18, data: dates.map((d) => byDay.get(d)?.items ?? 0) },
          { name: 'Used Convo', type: 'scatter', yAxisIndex: 1, data: dates.map((d) => { const v = byDay.get(d); return v && (v.opened || v.items > 0) ? 1 : null; }), itemStyle: { color: '#2E9D6A' } }],
      }} /></ChartCard></Col>
    </Row><p className="privacy-note">Encrypted items include messages, receipts, reactions and typing signals. Activity is recorded by day; no message content or recipients are shown.</p>
  </div>;
}

function OrganizationOverview({ days, data, throughput }: { days: number; data: Overview; throughput: import('react').ReactNode }) {
  const x = data?.days.map((d) => shortDay(d.day)) ?? [];
  const sum = (k: 'items' | 'calls' | 'newAccounts') => data?.days.reduce((n, d) => n + d[k], 0) ?? 0;
  const d = data?.directory;
  return (
    <div>
      <Row gutter={[16, 16]}>
        {[
          { title: 'People', value: d?.accounts, sub: `${d?.disabled ?? 0} disabled`, testId: 'kpi-accounts' },
          { title: 'Active today', value: d?.seenToday, sub: `${d?.seen7d ?? 0} this week · ${d?.seen30d ?? 0} this month`, testId: 'kpi-active' },
          { title: 'Linked devices', value: d?.devices, sub: d && d.accounts ? `${(d.devices / Math.max(1, d.accounts - d.disabled)).toFixed(1)} per active person` : '', testId: 'kpi-devices' },
          { title: `Encrypted items · ${days} d`, value: sum('items'), sub: 'messages, receipts, reactions…', testId: 'kpi-items' },
          { title: 'Groups', value: data?.groups.groups, sub: `${data?.groups.channels ?? 0} channels · ${data?.communities ?? 0} communities`, testId: 'kpi-groups' },
          { title: `Calls · ${days} d`, value: sum('calls'), sub: `${sum('newAccounts')} new people`, testId: 'kpi-calls' },
        ].map((k) => (
          <Col key={k.title} xs={24} sm={12} xl={4}>
            <Card className="kpi" data-testid={k.testId}>{data ? <Statistic title={k.title} value={k.value ?? 0} formatter={(v) => compact(Number(v))} /> : <Skeleton active paragraph={false} />}
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>{data ? k.sub : ' '}</Typography.Text></Card>
          </Col>
        ))}
        <Col xs={24} xl={16}>
          <ChartCard title="Activity" description={<>encrypted items sent and people active per day</>}>
            {data ? <Chart label="Encrypted items and active people per day" option={{
              xAxis: { type: 'category', data: x, boundaryGap: false },
              yAxis: [{ type: 'value', name: 'items', minInterval: 1 }, { type: 'value', name: 'people', minInterval: 1, splitLine: { show: false } }],
              series: [
                { name: 'Encrypted items', type: 'line', smooth: true, showSymbol: data.days.length === 1, areaStyle: { opacity: 0.12 }, data: data.days.map((v) => v.items) },
                { name: 'Active people', type: 'line', smooth: true, showSymbol: data.days.length === 1, yAxisIndex: 1, data: data.days.map((v) => v.activeAccounts) },
              ],
            }} /> : <Skeleton active />}
          </ChartCard>
        </Col>
        <Col xs={24} xl={8}>
          <ChartCard title="Who was active" description="Current directory · last device activity">
            {d ? <Chart label="People by last activity" height={280} option={{
              tooltip: { trigger: 'item' },
              legend: { bottom: 0, top: 'auto' },
              series: [{ type: 'pie', radius: ['48%', '72%'], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderRadius: 6, borderWidth: 2 },
                data: [
                  { name: 'Today', value: d.seenToday },
                  { name: 'This week', value: Math.max(0, d.seen7d - d.seenToday) },
                  { name: 'This month', value: Math.max(0, d.seen30d - d.seen7d) },
                  { name: 'Longer ago / never', value: Math.max(0, d.accounts - d.disabled - d.seen30d) },
                  { name: 'Disabled', value: d.disabled },
                ] }],
            }} /> : <Skeleton active />}
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>{throughput}</Col>
        <Col xs={24} xl={12}>
          <ChartCard title="Calls" data-testid="overview-calls" description={<>started per day</>}>
            {data ? <Chart label="Calls per day by type" height={240} option={{
              xAxis: { type: 'category', data: x }, yAxis: { type: 'value', minInterval: 1 },
              series: [
                { name: 'Voice', type: 'bar', stack: 'calls', barMaxWidth: 18, data: data.days.map((v) => v.calls - v.videoCalls) },
                { name: 'Video', type: 'bar', stack: 'calls', barMaxWidth: 18, data: data.days.map((v) => v.videoCalls) },
                { name: 'of which group', type: 'line', smooth: true, showSymbol: data.days.length === 1, data: data.days.map((v) => v.groupCalls) },
              ],
            }} /> : <Skeleton active />}
          </ChartCard>
        </Col>
      </Row>
      <p className="privacy-note" style={{ marginTop: 16 }}>Activity is retained until external maintenance removes it. Encrypted items include messages, receipts, reactions and typing signals; the server cannot tell them apart.</p>
    </div>
  );
}

function NewPeople({ data }: { data: Overview }) {
  return <ChartCard title="New people" description="First sign-in per day" data-testid="new-people-chart"><Chart label="New accounts per day" height={320} option={{
    xAxis: { type: 'category', data: data.days.map((d) => shortDay(d.day)) }, yAxis: { type: 'value', minInterval: 1 },
    series: [{ name: 'New people', type: 'bar', barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0], color: SERIES[2] }, data: data.days.map((d) => d.newAccounts) }],
  }} /></ChartCard>;
}
