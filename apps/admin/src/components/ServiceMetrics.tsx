import { useEffect, useState } from 'react';
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd';
import { api, errorText, type ServiceMetrics } from '../api';
import { fmtTime, seconds } from '../format';

/** Seconds as "45 s", "12 min", "3 h". */
function age(iso: string): string {
  const s = Math.round(seconds(iso));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

/**
 * Aggregate service health (ADM-01): mailbox backlog, push wake-ups, groups blocked by pending device
 * removal and device churn. Counts and ages only — no accounts, devices, relationships or presence.
 */
export function ServiceMetricsView({ version }: { version: number }) {
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => void api.serviceMetrics().then((m) => { if (active) { setMetrics(m); setError(null); } }).catch((e) => { if (active) setError(errorText(e)); });
    load(); const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [version]);
  if (error) return <Alert type="error" showIcon message={error} />;
  const m = metrics;
  const tile = (title: string, value: string | number | undefined, testId: string, warn = false, hint?: string) => (
    <Col xs={24} sm={12} lg={6}>
      <Card className="kpi" data-testid={testId}>
        <Statistic title={title} value={value ?? '—'} loading={!m} valueStyle={warn ? { color: '#D14B4B' } : undefined} />
        {hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text>}
      </Card>
    </Col>
  );
  return (
    <div data-testid="admin-service-metrics">
      <Typography.Paragraph type="secondary">Aggregate counts refreshed every 30 seconds{m ? ` · measured ${fmtTime(m.measuredAt)}` : ''}. No people, devices or conversations are identified here.</Typography.Paragraph>
      <Typography.Title level={5}>Message delivery</Typography.Title>
      <Row gutter={[16, 16]}>
        {tile('Encrypted messages waiting', m?.messaging.waitingEnvelopes, 'metric-waiting', false, 'Stored until the recipient device fetches them')}
        {tile('Devices with waiting messages', m?.messaging.devicesWithBacklog, 'metric-backlog-devices')}
        {tile('Oldest waiting message', m ? age(m.messaging.oldestWaiting) : undefined, 'metric-oldest', !!m && seconds(m.messaging.oldestWaiting) > 7 * 86400)}
        {tile('Connected sessions (this server)', m?.messaging.connectedSessions, 'metric-sessions', false, 'Per server instance')}
      </Row>
      <Typography.Title level={5} style={{ marginTop: 24 }}>Groups and devices</Typography.Title>
      <Row gutter={[16, 16]}>
        {tile('Groups', m?.groups.groups, 'metric-groups')}
        {tile('Groups paused by a revoked device', m?.groups.groupsBlockedByRemoval, 'metric-blocked-groups', !!m?.groups.groupsBlockedByRemoval,
          'An owner/admin or the device’s account must open the group to remove it')}
        {tile('Devices enrolled in 24 h', m?.devices24h.enrolled, 'metric-enrolled')}
        {tile('Devices revoked in 24 h', m?.devices24h.revoked, 'metric-revoked')}
      </Row>
      <Typography.Title level={5} style={{ marginTop: 24 }}>Wake-ups</Typography.Title>
      <Row gutter={[16, 16]}>
        {tile('Push wake-ups pending', m?.push.pending, 'metric-push-pending')}
        {tile('Oldest pending wake-up', m ? (m.push.pending ? age(m.push.oldestPending) : '0 s') : undefined, 'metric-push-oldest')}
        {tile('Departed members awaiting removal', m?.groups.pendingDepartures, 'metric-departures')}
      </Row>
    </div>
  );
}
