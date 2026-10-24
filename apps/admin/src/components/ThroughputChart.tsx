import { ChartCard } from './ChartCard';
import { useEffect, useState } from 'react';
import { Alert, Button, Popover, Segmented, Space, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
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
  return <ChartCard title="Throughput" description="Accepted operations per minute · live" data-testid="system-throughput" className="overview-operation-chart" extra={<Space size={4}><Segmented size="small" aria-label="Throughput window" value={minutes} onChange={(v) => onWindowChange(Number(v))} options={[{ value: 60, label: '1h' }, { value: 360, label: '6h' }, { value: 1440, label: '24h' }]} /><Popover title="What throughput counts" content={<Typography.Paragraph style={{ maxWidth: 360, margin: 0 }}>Accepted operations, refreshed every 15 seconds. An attachment message can contribute both an upload and an encrypted item. Uploads count when an upload session is created; they may not finish. Encrypted items also include receipts and reactions. Recording began {data ? dayjs(data.recordingSince).format('D MMM, HH:mm') : '…'}; earlier minutes have no observations.</Typography.Paragraph>}><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label="About throughput" /></Popover><Tooltip title="Refresh throughput"><Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => setVersion((v) => v + 1)} aria-label="Refresh throughput" /></Tooltip></Space>}>
    {error && <Alert type="error" showIcon message={error} />}
    {data?.enabled === false && <Alert type="info" message="Activity reporting is disabled for this deployment." />}

    {data && <Chart label="System operations per minute" height={240} option={{
      xAxis: { type: 'category', data: data.minutes.map((m) => dayjs(m.minute).format('HH:mm')), boundaryGap: false },
      yAxis: { type: 'value', minInterval: 1 }, dataZoom: [{ type: 'inside' }],
      series: [{ name: 'Encrypted items', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.items : null) },
        { name: 'Calls', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.calls : null) },
        { name: 'Uploads', type: 'line', stack: 'ops', showSymbol: false, areaStyle: { opacity: 0.15 }, data: data.minutes.map((m) => Date.parse(m.minute) >= recorded ? m.uploads : null) }],
    }} />}
    {data && <div className="throughput-summary"><Tooltip title="Current minute is still in progress"><span>Now <b>{totals.at(-1) ?? 0}</b></span></Tooltip><span>Peak <b>{Math.max(0, ...totals)}</b>/min</span><span>Average <b>{(complete.length ? complete.reduce((sum, n) => sum + n, 0) / complete.length : 0).toFixed(1)}</b>/min</span></div>}
  </ChartCard>;
}
