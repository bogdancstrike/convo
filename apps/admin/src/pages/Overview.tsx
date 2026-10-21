import { useEffect, useState } from 'react';
import { Alert, Card, Col, Row, Segmented, Skeleton, Statistic, Typography } from 'antd';
import { api, errorText, type Overview } from '../api';
import { Chart } from '../components/Chart';
import { compact, shortDay } from '../format';
import { SERIES } from '../theme';
import type { PageProps } from '../Shell';

/** Organization overview: directory totals and 7/30/90-day trends (counts only). */
export function OverviewPage(_: PageProps) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setData(null); void api.overview(days).then(setData).catch((e) => setError(errorText(e))); }, [days]);
  const x = data?.days.map((d) => shortDay(d.day)) ?? [];
  const sum = (k: 'items' | 'calls' | 'newAccounts') => data?.days.reduce((n, d) => n + d[k], 0) ?? 0;
  const d = data?.directory;
  return (
    <div data-testid="admin-overview">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>How Convo is used across the organization. Counts only: the server sees that encrypted items were sent, never what they contain or who they went to.</p>
        </div>
        <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }]} data-testid="overview-window" />
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {data && !data.activityTracking && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Activity tracking is turned off for this deployment (enclave.admin.activity.enabled); activity charts stay empty." />}
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
          <Card title="Activity" extra={<Typography.Text type="secondary">encrypted items sent and people active per day</Typography.Text>}>
            {data ? <Chart label="Encrypted items and active people per day" option={{
              xAxis: { type: 'category', data: x, boundaryGap: false },
              yAxis: [{ type: 'value', name: 'items', minInterval: 1 }, { type: 'value', name: 'people', minInterval: 1, splitLine: { show: false } }],
              series: [
                { name: 'Encrypted items', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.12 }, data: data.days.map((v) => v.items) },
                { name: 'Active people', type: 'line', smooth: true, showSymbol: false, yAxisIndex: 1, data: data.days.map((v) => v.activeAccounts) },
              ],
            }} /> : <Skeleton active />}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Who was active" extra={<Typography.Text type="secondary">by last device activity</Typography.Text>}>
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
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="New people" extra={<Typography.Text type="secondary">first sign-in per day</Typography.Text>}>
            {data ? <Chart label="New accounts per day" height={240} option={{
              xAxis: { type: 'category', data: x }, yAxis: { type: 'value', minInterval: 1 },
              series: [{ name: 'New people', type: 'bar', barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0], color: SERIES[2] }, data: data.days.map((v) => v.newAccounts) }],
            }} /> : <Skeleton active />}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="Calls" extra={<Typography.Text type="secondary">started per day</Typography.Text>}>
            {data ? <Chart label="Calls per day by type" height={240} option={{
              xAxis: { type: 'category', data: x }, yAxis: { type: 'value', minInterval: 1 },
              series: [
                { name: 'Voice', type: 'bar', stack: 'calls', barMaxWidth: 18, data: data.days.map((v) => v.calls - v.videoCalls) },
                { name: 'Video', type: 'bar', stack: 'calls', barMaxWidth: 18, data: data.days.map((v) => v.videoCalls) },
                { name: 'of which group', type: 'line', smooth: true, showSymbol: false, data: data.days.map((v) => v.groupCalls) },
              ],
            }} /> : <Skeleton active />}
          </Card>
        </Col>
      </Row>
      <p className="privacy-note" style={{ marginTop: 16 }}>Activity is kept for {data?.retentionDays ?? 90} days at day granularity. Encrypted items include messages, receipts, reactions and typing signals; the server cannot tell them apart.</p>
    </div>
  );
}
