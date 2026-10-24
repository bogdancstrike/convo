import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Drawer, Select, Space, Spin, Switch, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CompressOutlined, ExpandOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, errorText, type AlertDetail, type AlertSeverity, type AlertStatus, type SecurityAlert } from '../api';
import { AdminTable } from '../components/AdminTable';
import { AlertRules, ALERT_RULE_NAMES, useAlertRules } from '../components/AlertRules';
import { AlertRuleFlow } from '../components/AlertRuleFlow';
import { ChartCard } from '../components/ChartCard';
import { useAlertInbox } from '../components/SecurityAlertContext';
import { useReason } from '../components/confirm';
import { useViewState } from '../components/useViewState';
import { parseTableState } from '../components/tableState';
import { fmtTime } from '../format';
import type { PageProps } from '../Shell';

const COLORS: Record<AlertSeverity, string> = { critical: 'red', high: 'volcano', medium: 'gold', low: 'blue' };
const STATUS: Record<AlertStatus, string> = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' };

export function AlertsPage({ can, navigate, param }: PageProps) {
  const { view, update, link } = useViewState({ tab: 'inbox', status: 'open', severity: 'all', ruleId: 'all', display: '', ruleNode: '', flowRule: '', 'table_security-alerts': '' });
  const inbox = useAlertInbox(); const { message } = App.useApp(); const ask = useReason();
  const [detail, setDetail] = useState<AlertDetail | null>(null); const [error, setError] = useState<string | null>(null); const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setDetail(null); setError(null);
    if (param) void api.alertDetail(param).then((data) => { if (active) setDetail(data); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [param, version]);
  const rules = useAlertRules(version);
  const refresh = () => { inbox.refresh(); setVersion((v) => v + 1); };
  const close = () => navigate(link('alerts'));
  const expanded = view.display === 'page';
  const toggle = <Button type="text" icon={expanded ? <CompressOutlined /> : <ExpandOutlined />} aria-label={expanded ? 'Minimize view' : 'Maximize view'} onClick={() => update({ display: expanded ? '' : 'page' })} />;
  const transition = async (status: AlertStatus) => {
    if (!detail) return;
    const resolving = status === 'resolved';
    const reason = await ask(`${status === 'open' ? 'Reopen' : status === 'acknowledged' ? 'Acknowledge' : 'Resolve'} alert`,
      resolving ? 'A reason is optional. Your identity, and the reason if given, will be recorded in the alert history and audit log.' : 'The reason and your identity will be recorded in the alert history and audit log.', false, { optional: resolving });
    if (reason === null) return;
    try { setDetail(await api.alertStatus(detail.alert.id, status, reason)); refresh(); message.success('Alert updated'); } catch (e) { message.error(errorText(e)); }
  };
  /** Resolves every open or acknowledged alert matching the inbox's current scope, search and column filters, after confirming the count. */
  const resolveAll = async () => {
    const scope = { status: view.status, severity: view.severity, ruleId: view.ruleId };
    const query = parseTableState(view['table_security-alerts'], { q: '', sort: '', order: 'desc', page: 1, size: 1, filters: {} });
    const statuses = scope.status === 'all' ? ['open', 'acknowledged'] : scope.status === 'resolved' ? [] : [scope.status];
    try {
      const count = (await Promise.all(statuses.map((status) => api.table<SecurityAlert>('alerts', { ...scope, status }, { ...query, page: 1, size: 1 })))).reduce((sum, page) => sum + page.total, 0);
      if (!count) { message.info('No unresolved alerts match the current filters'); return; }
      const filtered = scope.status !== 'all' || scope.severity !== 'all' || scope.ruleId !== 'all' || !!query.q || Object.keys(query.filters).length > 0;
      const reason = await ask(`Resolve ${count} ${count === 1 ? 'alert' : 'alerts'}?`, `Every open and acknowledged alert ${filtered ? 'matching the current status, search and filters' : 'in the inbox'} will be resolved. A reason is optional; one history entry per alert and one audit entry are recorded. Later matching events open new alerts.`, false, { optional: true, okText: `Resolve ${count}` });
      if (reason === null) return;
      const { resolved } = await api.resolveAlerts(scope, query, reason);
      message.success(`${resolved} ${resolved === 1 ? 'alert' : 'alerts'} resolved`); refresh();
    } catch (e) { message.error(errorText(e)); }
  };
  const a = detail?.alert;
  const detailContent = <div className="security-detail-content" data-testid="alert-details">{error && <Alert type="error" showIcon message={error} />}{a ? <>
    <Space wrap><Tag color={COLORS[a.severity]}>{a.severity.toUpperCase()}</Tag><Tag>{STATUS[a.status]}</Tag><Typography.Text type="secondary">{ALERT_RULE_NAMES[a.ruleId]}</Typography.Text></Space>
    <Typography.Title level={3}>{a.title}</Typography.Title><Typography.Paragraph>{a.detail}</Typography.Paragraph>
    <Descriptions bordered column={1} size="small" items={[
      { key: 'subject', label: 'Who / target', children: a.subjectName }, { key: 'events', label: 'Observed events', children: a.occurrences },
      { key: 'first', label: 'First event', children: fmtTime(a.firstSeen) }, { key: 'last', label: 'Latest event', children: fmtTime(a.lastSeen) },
      { key: 'created', label: 'Alert created', children: fmtTime(a.createdAt) }, { key: 'updated', label: 'Last updated', children: fmtTime(a.updatedAt) },
    ]} />
    <Space wrap>{can('ALERTS_MANAGE') && <>
      {a.status === 'open' && <Button icon={<CheckOutlined />} onClick={() => void transition('acknowledged')} data-testid="alert-acknowledge">Acknowledge</Button>}
      {a.status !== 'resolved' && <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => void transition('resolved')} data-testid="alert-resolve">Resolve</Button>}
      {a.status !== 'open' && <Button onClick={() => void transition('open')} data-testid="alert-reopen">Reopen</Button>}
    </>}{can('AUDIT_READ') && a.firstSeq != null && <Button onClick={() => navigate(`audit?${new URLSearchParams({ table_audit: JSON.stringify({ q: '', sort: 'seq', order: 'asc', page: 1, size: 50, filters: {} }), user: a.subject.replace(/^idp:/, '').split(' ')[0]!, from: a.firstSeen, to: a.lastSeen })}`)}>View audit evidence</Button>}
    {can('ACCOUNTS_READ') && a.subject.startsWith('idp:') && /^[0-9a-f-]{36}$/.test(a.subject.slice(4).split(' ')[0]!) && <Button onClick={() => navigate(`users/sign-in/${a.subject.slice(4).split(' ')[0]}/security?display=page`)}>Manage person</Button>}
    {a.ruleId === 'audit-sync' && can('HEALTH_READ') && <Button onClick={() => navigate('health')}>Inspect system health</Button>}</Space>
    <Typography.Title level={5}>Alert history</Typography.Title><Typography.Text type="secondary">Latest 100 changes</Typography.Text>
    <Timeline items={detail.history.map((h) => ({ key: h.id, color: h.status === 'resolved' ? 'green' : 'blue', children: <div><Typography.Text strong>{STATUS[h.status]} · {h.actor}</Typography.Text><div>{h.reason}</div><Typography.Text type="secondary">{fmtTime(h.at)}</Typography.Text></div> }))} />
  </> : !error && <Spin />}</div>;
  if (param && expanded) return <div className="page-frame"><div className="page-head"><Space><Button icon={<ArrowLeftOutlined />} onClick={close}>Back to alerts</Button><h1>Security alert</h1></Space>{toggle}</div><Card className="security-detail-page">{detailContent}</Card></div>;
  return <div className="page-frame page-alerts" data-testid="admin-alerts"><div className="page-head"><div><h1>Security alerts</h1><p>Review suspicious activity, track investigations and tune detection rules.</p></div><Button icon={<ReloadOutlined />} onClick={refresh} data-testid="alerts-refresh">Refresh</Button></div>
    {inbox.error && <Alert type="error" showIcon message={inbox.error} />}{inbox.summary?.error && <Alert type="error" showIcon message={inbox.summary.error} />}
    {inbox.summary?.processedAt && Date.now() - Date.parse(inbox.summary.processedAt) > 90_000 && <Alert type="warning" showIcon message="Security alert processing is behind" description="The last completed detection check is older than 90 seconds. Results may be delayed." />}
    <div className="alert-summary-strip">{([['Open', inbox.summary?.open], ['Acknowledged', inbox.summary?.acknowledged], ['Critical unresolved', inbox.summary?.critical]] as const).map(([label, value]) => <div key={label}><strong>{value ?? '—'}</strong><span>{label}</span></div>)}<div className="alert-sync-info"><span>Detection checked {fmtTime(inbox.summary?.processedAt)}</span><Space>Desktop alerts<Switch size="small" checked={inbox.desktop} aria-label="Desktop security notifications" onChange={(value) => { void inbox.setDesktop(value).catch((e: Error) => message.error(e.message)); }} /></Space></div></div>
    <Tabs activeKey={view.tab} onChange={(tab) => update({ tab })} items={[
      { key: 'inbox', label: 'Inbox', children: <Card className="table-surface" styles={{ body: { minHeight: 0 } }}><AdminTable<SecurityAlert> id="security-alerts" resource="alerts" rowKey="id" defaultSize={10} defaultSort="createdAt" defaultOrder="desc" refreshKey={`${version}:${inbox.summary?.processedAt}`} scope={{ status: view.status, severity: view.severity, ruleId: view.ruleId }} searchId="alerts-search" testId="alerts-table" searchPlaceholder="Search alerts, people or details" controls={<Space wrap>
        <Select aria-label="Alert status" popupMatchSelectWidth={false} value={view.status} onChange={(status) => update({ status })} options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} />
        <Select aria-label="Alert severity" popupMatchSelectWidth={false} value={view.severity} onChange={(severity) => update({ severity })} options={[{ value: 'all', label: 'All severities' }, ...Object.keys(COLORS).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))]} />
        <Select aria-label="Alert rule" popupMatchSelectWidth={false} value={view.ruleId} onChange={(ruleId) => update({ ruleId })} options={[{ value: 'all', label: 'All rules' }, ...Object.entries(ALERT_RULE_NAMES).map(([value, label]) => ({ value, label }))]} />
        {can('ALERTS_MANAGE') && <Tooltip title="Resolve every open and acknowledged alert that matches the current status, search and filters"><Button icon={<SafetyCertificateOutlined />} disabled={!inbox.summary?.open && !inbox.summary?.acknowledged} onClick={() => void resolveAll()} data-testid="alerts-resolve-all">Resolve all</Button></Tooltip>}
      </Space>} onRow={(row) => ({ onClick: () => navigate(link(`alerts/${row.id}`)), style: { cursor: 'pointer' } })} columns={[
        { title: 'Alert', key: 'title', render: (_, row) => <Button type="link" className="person-link" title={row.title} onClick={() => navigate(link(`alerts/${row.id}`))}>{row.title}</Button> },
        { title: 'Severity', key: 'severity', render: (_, row) => <Tag color={COLORS[row.severity]}>{row.severity.toUpperCase()}</Tag> },
        { title: 'Status', key: 'status', render: (_, row) => STATUS[row.status] }, { title: 'Who / target', key: 'subjectName', dataIndex: 'subjectName' },
        { title: 'Events', key: 'occurrences', dataIndex: 'occurrences' }, { title: 'Created', key: 'createdAt', render: (_, row) => fmtTime(row.createdAt) }, { title: 'Latest event', key: 'lastSeen', render: (_, row) => fmtTime(row.lastSeen) },
      ]} /></Card> },
      { key: 'enabled', label: 'Enabled rules', children: <ChartCard className="diagram-surface alert-flow-surface" title="How enabled rules raise alerts" description="Pick a rule to follow it from event source to operator review, using its current settings. Select a card for details."><AlertRuleFlow rules={rules.rules} error={rules.error} rule={view.flowRule} onRule={(flowRule) => update({ flowRule, ruleNode: '' })} selected={view.ruleNode} onSelect={(ruleNode) => update({ ruleNode }, !ruleNode)} /></ChartCard> },
      { key: 'rules', label: 'Detection rules', children: <AlertRules rules={rules.rules} error={rules.error} editable={can('ALERT_RULES_MANAGE')} onSaved={(updated) => { rules.setRules(updated); inbox.refresh(); }} /> },
    ]} />
    {param && <Drawer open width={720} title="Security alert" onClose={close} extra={toggle} destroyOnHidden>{detailContent}</Drawer>}
  </div>;
}
