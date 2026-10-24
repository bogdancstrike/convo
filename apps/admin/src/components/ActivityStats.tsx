import { ChartCard } from './ChartCard';
import { Card, Col, Row, Skeleton, Statistic } from 'antd';
import { Chart } from './Chart';
import { SERIES } from '../theme';
import type { Levels, Overview } from '../api';
import { LEVEL, shortDay } from '../format';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Activity KPIs and charts: levels, active people per day, and items by weekday. */
export function ActivityStats({ days, levels, overview }: { days: number; levels: Levels | null; overview: Overview | null }) {
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
        <ChartCard title="Activity levels" description={<>share of active days</>}>
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
        </ChartCard>
      </Col>
      <Col xs={24} xl={10}>
        <ChartCard title="People using Convo per day" description={<>sent something vs only opened</>}>
          {overview ? <Chart label="People using Convo per day, split into senders and readers" height={260} option={{
            xAxis: { type: 'category', data: overview.days.map((d) => shortDay(d.day)), boundaryGap: false }, yAxis: { type: 'value', minInterval: 1 },
            series: [
              { name: 'Sent something', type: 'line', stack: 'people', smooth: true, showSymbol: false, areaStyle: { opacity: 0.35 }, data: overview.days.map((d) => d.senders) },
              { name: 'Only opened', type: 'line', stack: 'people', smooth: true, showSymbol: false, areaStyle: { opacity: 0.2 }, data: overview.days.map((d) => Math.max(0, d.activeAccounts - d.senders)) },
            ],
          }} /> : <Skeleton active />}
        </ChartCard>
      </Col>
      <Col xs={24} xl={6}>
        <ChartCard title="By weekday" description={<>encrypted items</>}>
          {overview ? <Chart label="Encrypted items by weekday" height={260} option={{
            xAxis: { type: 'category', data: WEEKDAYS }, yAxis: { type: 'value', minInterval: 1 },
            series: [{ name: 'Items', type: 'bar', barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0], color: SERIES[2] }, data: byWeekday }],
          }} /> : <Skeleton active />}
        </ChartCard>
      </Col>
      <Col xs={24} xl={16}>
        <ChartCard title="Web and Android" description={<>people per day on each platform</>}>
          {overview ? <Chart label="People per day on web and Android" height={240} option={{
            xAxis: { type: 'category', data: overview.days.map((d) => shortDay(d.day)) }, yAxis: { type: 'value', minInterval: 1 },
            series: [
              { name: 'Web', type: 'bar', barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0] }, data: overview.days.map((d) => d.webUsers) },
              { name: 'Android', type: 'bar', barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0], color: SERIES[4] }, data: overview.days.map((d) => d.androidUsers) },
            ],
          }} /> : <Skeleton active />}
        </ChartCard>
      </Col>
      <Col xs={24} xl={8}>
        <ChartCard title="Platform share" description={<>person-days in the period</>}>
          {overview ? <Chart label="Share of usage by platform" height={240} option={{
            tooltip: { trigger: 'item' }, legend: { bottom: 0, top: 'auto' },
            series: [{ type: 'pie', radius: ['45%', '72%'], label: { show: false }, itemStyle: { borderRadius: 6, borderWidth: 2 }, data: [
              { name: 'Web', value: overview.days.reduce((n, d) => n + d.webUsers, 0), itemStyle: { color: SERIES[0] } },
              { name: 'Android', value: overview.days.reduce((n, d) => n + d.androidUsers, 0), itemStyle: { color: SERIES[4] } },
            ] }],
          }} /> : <Skeleton active />}
        </ChartCard>
      </Col>
    </Row>
  );
}
