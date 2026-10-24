import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Empty, Row, Statistic, Table, Typography } from 'antd';
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { api, errorText, type Health } from '../api';
import { useReason } from '../components/confirm';
import { seconds } from '../format';
import type { PageProps } from '../Shell';

const REASONS: Record<string, string> = { gave_up: 'Gave up after retries', expired: 'Expired before delivery', rejected: 'Rejected by the push service' };

/** Delivery health: content-free push wake-ups (counts only). */
export function HealthPage({ can }: PageProps) {
  const { message } = App.useApp();
  const ask = useReason();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api.health().then(setHealth).catch((e) => setError(errorText(e)));
  useEffect(load, []);
  const dead = Object.entries(health?.push.deadLetters ?? {}).map(([key, n]) => { const [reason = '', kind = ''] = key.split('/'); return { key, reason, kind, n }; });
  const messageDead = dead.filter((d) => d.kind === 'message').reduce((s, d) => s + d.n, 0);
  return (
    <div className="page-frame page-health" data-testid="admin-health">
      <div className="page-head">
        <div><h1>Health</h1><p>Push wake-ups tell offline phones to fetch their encrypted messages. A missed wake-up loses nothing: messages wait in the device's mailbox.</p></div>
        <Button icon={<ReloadOutlined />} onClick={load} data-testid="admin-health-refresh">Refresh</Button>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Waiting for delivery or retry" value={health?.push.pending ?? 0} loading={!health} /><span data-testid="admin-push-pending" hidden>{health?.push.pending}</span></Card></Col>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Oldest waiting" value={health?.push.pending ? Math.round(seconds(health.push.oldestPending)) : 0} suffix="s" loading={!health} /></Card></Col>
        <Col xs={24} md={8}><Card className="kpi"><Statistic title="Failed in 24 hours" value={dead.reduce((s, d) => s + d.n, 0)} loading={!health} valueStyle={dead.length ? { color: '#D14B4B' } : undefined} /><span data-testid="admin-push-dead" hidden>{dead.reduce((s, d) => s + d.n, 0)}</span></Card></Col>
        <Col span={24}>
          <Card title="Failed wake-ups" extra={can('PUSH_REDRIVE') && messageDead > 0 && <Button type="primary" icon={<SendOutlined />} data-testid="admin-push-redrive" onClick={async () => {
            const reason = await ask('Retry failed wake-ups', 'Queues the failed message wake-ups again (for example after the push service was down). Call rings are never re-sent.');
            if (!reason) return;
            try { const r = await api.redrive(reason); message.success(`${r.queued} wake-ups queued again.`); load(); } catch (e) { message.error(errorText(e)); }
          }}>Retry failed message wake-ups</Button>}>
            {dead.length === 0 ? <Empty description="No failures in the last 24 hours" /> : (
              <Table rowKey="key" pagination={false} dataSource={dead} onRow={() => ({ 'data-testid': 'admin-push-dead-row' } as never)} columns={[
                { title: 'Reason', dataIndex: 'reason', render: (r: string) => REASONS[r] ?? r },
                { title: 'Kind', dataIndex: 'kind', render: (k: string) => k === 'call' ? 'Call rings' : 'Messages' },
                { title: 'Count', dataIndex: 'n', align: 'right' },
              ]} />)}
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>Only counts are shown; failures are kept for 24 hours without device addresses or content.</Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
