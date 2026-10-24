import { ChartCard } from './ChartCard';
import { useEffect, useState } from 'react';
import { Alert, Button, Segmented, Space, Statistic, Typography } from 'antd';
import dayjs from 'dayjs';
import { api, errorText, type Throughput } from '../api';
import { Chart } from './Chart';

export function ThroughputChart({ minutes, onWindowChange }: { minutes: number; onWindowChange: (minutes: number) => void }) {
  const [data, setData] = useState<Throughput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => void api.throughput(minutes).then((v) => { if (active) { setData(v); setError(null); } }).catch((e) => { if (active) setError(errorText(e)); });
    load(); const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [minutes, version]);
  const totals = data?.minutes.map((m) => m.items + m.calls + m.uploads) ?? [];
  const recorded = data ? dayjs(data.recordingSince).startOf('minute').valueOf() : Infinity;
  const complete = data?.minutes.slice(0, -1).filter((m) => Date.parse(m.minute) >= recorded).map((m) => m.items + m.calls + m.uploads) ?? [];
  return <ChartCard title="System throughput" data-testid="system-throughput" extra={<Space wrap><Segmented aria-label="Throughput window" value={minutes} onChange={(v) => onWindowChange(Number(v))} options={[{ value: 60, label: '1 hour' }, { value: 360, label: '6 hours' }, { value: 1440, label: '24 hours' }]} /><Button onClick={() => setVersion((v) => v + 1)}>Refresh</Button></Space>}>
    {error && <Alert type="error" showIcon message={error} />}
    {data?.enabled === false && <Alert type="info" message="Activity reporting is disabled for this deployment." />}
    <div className="throughput-facts"><Statistic title="Current minute · in progress" value={totals.at(-1) ?? 0} suffix="ops" /><Statistic title="Peak minute" value={Math.max(0, ...totals)} suffix="ops/min" /><Statistic title="Average · completed minutes" value={complete.length ? complete.reduce((sum, n) => sum + n, 0) / complete.length : 0} precision={1} suffix="ops/min" /></div>
    {data && <Chart label="System operations per minute" height={300} option={{
      xAxis: { type: 'category', data: data.minutes.map((m) => dayjs(m.minute).format('HH:mm')), boundaryGap: false },
      yAxis: { type: 'value', name: 'operations / minute', minInterval: 1 }, dataZoom: [{ type: 'inside' }],
      series: [{ name: 'Encrypted items accepted', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.items : null) },
        { name: 'Calls started', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.calls : null) },
        { name: 'Attachment uploads started', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.uploads : null) }],
    }} />}
    <Typography.Paragraph type="secondary" className="privacy-note">Accepted operations, refreshed every 15 seconds. An attachment message can contribute both an upload and an encrypted item. Uploads count when an upload session is created; they may not finish. Encrypted items also include receipts and reactions. Recording began {data ? dayjs(data.recordingSince).format('D MMM, HH:mm') : '…'}; earlier minutes have no observations.</Typography.Paragraph>
  </ChartCard>;
}
