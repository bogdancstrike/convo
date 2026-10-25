import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Row, Statistic, Tabs, Typography } from 'antd';
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { api, errorText, type Health, type SystemHealth } from '../api';
import { AdminTable } from '../components/AdminTable';
import { SystemHealthView } from '../components/SystemHealthView';
import { ServiceMetricsView } from '../components/ServiceMetrics';
import { useViewState } from '../components/useViewState';
import { useReason } from '../components/confirm';
import { seconds } from '../format';
import type { PageProps } from '../Shell';

const REASONS: Record<string, string> = { gave_up: 'Gave up after retries', expired: 'Expired before delivery', rejected: 'Rejected by the push service' };

/** System dependencies and independent, content-free delivery diagnostics. */
export function HealthPage({ can }: PageProps) {
  const { message } = App.useApp();
  const ask = useReason();
  const [health, setHealth] = useState<Health | null>(null);
  const [system, setSystem] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const { view, update } = useViewState({ tab: 'system' });
  const load = () => setVersion((v) => v + 1);
  useEffect(() => {
    let active = true, sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      setBusy(true);
      void api.systemHealth().then((data) => { if (active && request === sequence) { setSystem(data); setSystemError(null); } }).catch((e) => { if (active && request === sequence) setSystemError(errorText(e)); }).finally(() => { if (active && request === sequence) setBusy(false); });
      void api.health().then((data) => { if (active && request === sequence) { setHealth(data); setError(null); } }).catch((e) => { if (active && request === sequence) setError(errorText(e)); });
    };
    refresh(); const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [version]);
  const dead = Object.entries(health?.push.deadLetters ?? {}).map(([key, n]) => { const [reason = '', kind = ''] = key.split('/'); return { key, reason, kind, n }; });
  const messageDead = dead.filter((d) => d.kind === 'message').reduce((s, d) => s + d.n, 0);
  return (
    <div className="page-frame page-health" data-testid="admin-health">
      <div className="page-head">
        <div><h1>Health</h1><p>Live checks across the system, from sign-in and storage to calls and delivery. Select a component to inspect its check and response.</p></div>
        <Button icon={<ReloadOutlined />} loading={busy} onClick={load} data-testid="admin-health-refresh">Refresh</Button>
      </div>
      <Tabs activeKey={view.tab} onChange={(tab) => update({ tab })} items={[{ key: 'system', label: 'System health', children: <SystemHealthView snapshot={system} error={systemError} busy={busy} onRefresh={load} /> }, { key: 'service', label: 'Service metrics', children: <ServiceMetricsView version={version} /> }, { key: 'delivery', label: 'Push delivery', children: <div className="health-delivery-panel">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Waiting for delivery or retry" value={health?.push.pending ?? '—'} loading={!health && !error} /><span data-testid="admin-push-pending" hidden>{health?.push.pending}</span></Card></Col>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Oldest waiting" value={health ? health.push.pending ? Math.round(seconds(health.push.oldestPending)) : 0 : '—'} suffix="s" loading={!health && !error} /></Card></Col>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Failed in 24 hours" value={health ? dead.reduce((s, d) => s + d.n, 0) : '—'} loading={!health && !error} valueStyle={dead.length ? { color: '#D14B4B' } : undefined} /><span data-testid="admin-push-dead" hidden>{dead.reduce((s, d) => s + d.n, 0)}</span></Card></Col>
        <Col span={24}>
          <Card title="Failed wake-ups" extra={can('PUSH_REDRIVE') && messageDead > 0 && <Button type="primary" icon={<SendOutlined />} data-testid="admin-push-redrive" onClick={async () => {
            const reason = await ask('Retry failed wake-ups', 'Queues the failed message wake-ups again (for example after the push service was down). Call rings are never re-sent.');
            if (!reason) return;
            try { const r = await api.redrive(reason); message.success(`${r.queued} wake-ups queued again.`); load(); } catch (e) { message.error(errorText(e)); }
          }}>Retry failed message wake-ups</Button>}>
            <div className="health-table"><AdminTable<{ key: string; reason: string; kind: string; n: number }> id="health" resource="health" rowKey="key" defaultSort="n" defaultOrder="desc" refreshKey={health} columns={[
              { title: 'Reason', key: 'reason', dataIndex: 'reason', render: (r: string) => REASONS[r] ?? r },
              { title: 'Kind', key: 'kind', dataIndex: 'kind', render: (k: string) => k === 'call' ? 'Call rings' : 'Messages' },
              { title: 'Count', key: 'n', dataIndex: 'n', align: 'right' },
            ]} /></div>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>Only counts are shown, without device addresses or content. Data cleanup is managed externally.</Typography.Paragraph>
          </Card>
        </Col>
      </Row></div> }] } />
    </div>
  );
}
