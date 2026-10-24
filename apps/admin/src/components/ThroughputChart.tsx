import { ChartCard } from './ChartCard';
import { useEffect, useState } from 'react';
import { Alert, Button, Popover, Segmented, Skeleton, Space, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, errorText, type DateRange, type Throughput } from '../api';
import { Chart } from './Chart';

export function ThroughputChart({ minutes = 60, onWindowChange, range }: { minutes?: number; onWindowChange?: (minutes: number) => void; range?: DateRange }) {
  const [data, setData] = useState<Throughput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setError(null);
    const load = () => void api.throughput(minutes, range).then((v) => { if (active) { setData(v); setError(null); } }).catch((e) => { if (active) setError(errorText(e)); });
    load();
    const historical = range?.to && range.to < new Date().toISOString().slice(0, 10);
    const timer = historical ? null : setInterval(load, 15000);
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [minutes, range?.from, range?.to, version]);
  const bucket = data?.bucketMinutes ?? 1;
  const recorded = data ? dayjs(data.recordingSince).startOf('minute').valueOf() : Infinity;
  const observed = (minute: string) => data ? Math.max(0, (Math.min(Date.parse(minute) + bucket * 60_000, Date.parse(data.to ?? data.capturedAt)) - Math.max(Date.parse(minute), recorded)) / 60_000) : 0;
  const rate = (minute: string, count: number) => { const span = observed(minute); return span ? Math.round(count / span * 100) / 100 : null; };
  const totals = data?.minutes.map((m) => rate(m.minute, m.items + m.calls + m.uploads)) ?? [];
  const complete = data?.minutes.filter((m) => observed(m.minute) > 0 && Date.parse(m.minute) + bucket * 60_000 <= Date.parse(data.capturedAt)) ?? [];
  const totalTime = complete.reduce((sum, m) => sum + observed(m.minute), 0);
  const average = totalTime ? complete.reduce((sum, m) => sum + m.items + m.calls + m.uploads, 0) / totalTime : null;
  return <ChartCard title="Throughput" description={bucket > 1 ? `Operations per minute · ${bucket}-minute averages` : 'Accepted operations per minute'} data-testid="system-throughput" className="overview-operation-chart" extra={<Space size={4}>
    {!range && onWindowChange && <Segmented size="small" aria-label="Throughput window" value={minutes} onChange={(v) => onWindowChange(Number(v))} options={[{ value: 60, label: '1h' }, { value: 360, label: '6h' }, { value: 1440, label: '24h' }]} />}
    <Popover title="What throughput counts" content={<Typography.Paragraph style={{ maxWidth: 360, margin: 0 }}>Accepted operations, refreshed every 15 seconds for live ranges. An attachment message can contribute both an upload and an encrypted item. Uploads count when an upload session is created; they may not finish. Encrypted items also include receipts and reactions. Longer ranges use per-minute averages over the displayed buckets.</Typography.Paragraph>}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label="About throughput" /></Popover>
    <Tooltip title="Refresh throughput"><Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => setVersion((v) => v + 1)} aria-label="Refresh throughput" /></Tooltip></Space>}>
    {error && <Alert type="error" showIcon message={error} />}
    {data?.enabled === false && <Alert type="info" message="Activity reporting is disabled for this deployment." />}
    {data ? <Chart label="System operations per minute" height={240} option={{
      xAxis: { type: 'category', data: data.minutes.map((m) => dayjs(m.minute).format(range && range.from !== range.to ? 'D MMM HH:mm' : 'HH:mm')), boundaryGap: false },
      yAxis: { type: 'value', minInterval: 1 }, dataZoom: [{ type: 'inside' }],
      series: [{ name: 'Encrypted items', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => rate(m.minute, m.items)) },
        { name: 'Calls', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => rate(m.minute, m.calls)) },
        { name: 'Uploads', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => rate(m.minute, m.uploads)) }],
    }} /> : !error ? <Skeleton active style={{ height: 240 }} /> : null}
    {data && <div className="throughput-summary"><Tooltip title="Latest observed bucket; the current bucket may be incomplete"><span>Latest <b>{totals.at(-1) ?? '—'}</b>/min</span></Tooltip><span>Peak <b>{totals.some((n) => n !== null) ? Math.max(...totals.filter((n): n is number => n !== null)) : '—'}</b>/min</span><span>Average <b>{average === null ? '—' : average.toFixed(1)}</b>/min</span></div>}
  </ChartCard>;
}
