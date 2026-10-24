import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, App, Button, Card, Descriptions, Drawer, Empty, List, Segmented, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { DeleteOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined, ExpandOutlined, CompressOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { api, errorText, type AccountActivity, type AccountSummary, type DeviceSummary, type Permission } from '../api';
import { UserSystemChart } from './UserSystemChart';
import { Chart } from './Chart';
import { fmtDay, fmtTime, LEVEL, nameOf, shortDay } from '../format';
import { useReason } from './confirm';
import { SessionTable } from './SessionTable';
import { AuditTrail } from './AuditTrail';
import { SignInSections, useSignIn } from './SignInPanel';

/** Everything about one Convo account an administrator may see and do (never message content). */
export function UserDrawer({ accountId: requestedAccountId, subjectId, tab = 'overview', days = 30, expanded = false, graphNode = '', onGraphNodeChange, onMaximize, onDaysChange, onTabChange, onClose, can, onChanged }: {
  graphNode?: string; onGraphNodeChange?: (node: string) => void; expanded?: boolean; onMaximize?: () => void; days?: number; onDaysChange?: (days: number) => void; accountId: string | null; subjectId?: string | null; tab?: string; onTabChange?: (tab: string) => void;
  onClose: () => void; can: (p: Permission) => boolean; onChanged?: () => void;
}) {
  const { message } = App.useApp();
  const ask = useReason();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const loadSignIn = useCallback(() => subjectId ? api.idpUser(subjectId) : api.signInOf(requestedAccountId!), [subjectId, requestedAccountId]);
  const signIn = useSignIn(loadSignIn);
  const accountId = requestedAccountId ?? signIn.account?.convoAccountId ?? null;
  const [auditVersion, setAuditVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accountId) return;
    setError(null);
    if (can('STATS_READ')) void api.accountActivity(accountId, days).then((a) => { setActivity(a); setAccount(a.summary.account); }).catch((e) => setError(errorText(e)));
    else void api.account(accountId).then(setAccount).catch((e) => setError(errorText(e)));
    if (can('DEVICES_READ')) void api.devices(accountId).then(setDevices).catch(() => setDevices([]));
  }, [accountId, days, can]);
  useEffect(() => { setAccount(null); setActivity(null); setDevices(null); }, [accountId]);
  useEffect(load, [load]);
  const changed = () => { setAuditVersion((v) => v + 1); signIn.refresh(); load(); onChanged?.(); };
  const run = async (work: Promise<unknown>, done: string) => { try { await work; message.success(done); changed(); } catch (e) { message.error(errorText(e)); } };
  const u = signIn.account?.user;
  const personName = account ? nameOf(account) : u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username : 'User';
  const level = activity?.summary.level;
  return (
    <DetailSurface expanded={expanded} onClose={onClose} onMaximize={onMaximize}
      title={<Space wrap>{personName}<Typography.Text type="secondary">@{account?.username ?? u?.username ?? ''}</Typography.Text>
        {account?.status === 'disabled' && <Tag color="red">Disabled</Tag>}{u && <Tag color={u.enabled ? 'green' : 'red'}>{u.enabled ? 'Sign-in allowed' : 'Sign-in blocked'}</Tag>}
        {u && !accountId && <Tag>Not joined yet</Tag>}{level && <Tag color={LEVEL[level].color}>{LEVEL[level].label}</Tag>}</Space>}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {((accountId && !account && !error) || (!accountId && !u && !signIn.error)) ? <Spin /> : (
        <Tabs activeKey={tab} onChange={onTabChange} items={[
          { key: 'organization', label: 'Organization', children: <UserSystemChart identity={signIn.account} account={account} devices={devices} selected={graphNode} onSelect={(id) => onGraphNodeChange?.(id)} onTab={(key) => onTabChange?.(key)} /> },
          { key: 'overview', label: 'Overview', children: <SignInSections {...signIn} can={can} onChanged={changed} sections={['details']} /> },
          ...(account && can('STATS_READ') ? [{ key: 'activity', label: 'Activity', children: (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Segmented value={days} onChange={(v) => onDaysChange?.(Number(v))} options={[{ label: '30 days', value: 30 }, { label: '90 days', value: 90 }]} />
              {activity && (() => {
                const used = activity.days.filter((d) => d.opened || d.items > 0);
                return <Descriptions column={2} bordered data-testid="activity-facts">
                  <Descriptions.Item label="Days used">{used.length} of {activity.window}</Descriptions.Item>
                  <Descriptions.Item label="Days with something sent">{activity.days.filter((d) => d.items > 0).length}</Descriptions.Item>
                  <Descriptions.Item label="Encrypted items">{activity.summary.items}</Descriptions.Item>
                  <Descriptions.Item label="Platforms">{`Web ${activity.days.filter((d) => d.web).length} d · Android ${activity.days.filter((d) => d.android).length} d`}</Descriptions.Item>
                  <Descriptions.Item label="Last active">{fmtDay(activity.summary.lastActiveDay)}</Descriptions.Item>
                  <Descriptions.Item label="Last device activity">{fmtDay(account.lastSeenDay)}</Descriptions.Item>
                </Descriptions>;
              })()}
              {activity && activity.days.length > 0 ? (() => {
                const byDay = new Map(activity.days.map((d) => [d.day, d]));
                const axis: string[] = [], items: number[] = [], opened: (number | null)[] = [], calendar: [string, number][] = [];
                for (let i = activity.window - 1; i >= 0; i--) {
                  const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); const v = byDay.get(d);
                  axis.push(shortDay(d)); items.push(v?.items ?? 0); opened.push(v && (v.opened || v.items > 0) ? 1 : null);
                  calendar.push([d, v ? (v.items > 0 ? Math.min(4, 1 + Math.ceil(Math.log10(v.items + 1) * 1.5)) : 1) : 0]);
                }
                const first = calendar[0]![0], last = calendar[calendar.length - 1]![0];
                return <>
                  <Chart label={`Daily activity of ${account.username}`} height={240} option={{
                    xAxis: { type: 'category', data: axis },
                    yAxis: [{ type: 'value', minInterval: 1, name: 'items' }, { type: 'value', min: 0, max: 1, show: false }],
                    series: [
                      { name: 'Encrypted items', type: 'bar', barMaxWidth: 12, itemStyle: { borderRadius: [3, 3, 0, 0] }, data: items },
                      { name: 'Used Convo', type: 'scatter', yAxisIndex: 1, symbolSize: 9, itemStyle: { color: '#2E9D6A' }, data: opened },
                    ],
                  }} />
                  <Chart label={`Usage calendar of ${account.username}`} height={170} option={{
                    tooltip: { trigger: 'item', formatter: (p: unknown) => { const v = (p as { value: [string, number] }).value; return `${v[0]}: ${['not used', 'opened', 'some activity', 'active', 'very active'][v[1]] ?? ''}`; } },
                    legend: { show: false },
                    visualMap: { show: false, min: 0, max: 4, inRange: { color: ['#e6eaee', '#bfe3ef', '#7cc4de', '#2596BE', '#17324D'] } },
                    calendar: { range: [first, last], cellSize: ['auto', 16], top: 30, left: 30, right: 10, yearLabel: { show: false }, dayLabel: { firstDay: 1, nameMap: 'en' }, splitLine: { show: false }, itemStyle: { borderWidth: 3, borderColor: 'transparent' } },
                    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: calendar }],
                  }} />
                </>;
              })() : <Empty description="No activity in this period" />}
            </Space>) }] : []),
          ...(account && can('DEVICES_READ') ? [{ key: 'devices', label: `Devices${devices ? ` (${devices.length})` : ''}`, children: (
            <List data-testid="admin-device-list" dataSource={devices ?? []} locale={{ emptyText: 'No linked devices' }} renderItem={(d) => (
              <List.Item actions={can('DEVICE_REVOKE') ? [<Button key="r" size="small" danger icon={<DeleteOutlined />} data-testid="admin-revoke" onClick={async () => {
                const reason = await ask('Unlink device', `Device ${d.deviceId} (${d.platform}) is signed out at once and can no longer receive messages.`, true);
                if (reason) await run(api.revokeDevice(account.accountId, d.deviceId, reason), 'Device unlinked');
              }}>Unlink</Button>] : []}>
                <List.Item.Meta title={`${d.platform} · device ${d.deviceId}`} description={`Linked ${fmtTime(d.createdAt)} · last active ${fmtDay(d.lastSeenDay)}`} />
              </List.Item>)} />) }] : []),
          ...(can('AUDIT_READ') ? [{ key: 'audit', label: 'Audit', children: <AuditTrail subjects={[account?.accountId ?? '', u?.id ?? '']} version={auditVersion} /> }] : []),
          { key: 'roles', label: 'Roles', children: <SignInSections {...signIn} can={can} onChanged={changed} sections={['roles']} /> },
          ...(u && can('SESSIONS_READ') ? [{ key: 'sessions', label: 'Sessions', children: <div className="user-sessions-tab"><SessionTable userId={u.id} can={can} onOpen={(s) => { window.location.hash = `/sessions/${s.id}?user=${encodeURIComponent(u.id)}`; }} /></div> }] : []),
          { key: 'security', label: 'Security', children: (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <SignInSections {...signIn} can={can} onChanged={changed} sections={['actions']} />
              {account && <>
              <Descriptions column={1} bordered>
                <Descriptions.Item label="Status">{account.status === 'active' ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag>}</Descriptions.Item>
                <Descriptions.Item label="First sign-in">{fmtTime(account.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="Linked devices">{account.activeDevices}</Descriptions.Item>
              </Descriptions>
              {can('ACCOUNT_STATUS') && (account.status === 'active'
                ? <Button danger icon={<StopOutlined />} data-testid="admin-toggle-status" onClick={async () => {
                    const reason = await ask('Disable account', 'Every device of this account is refused at once and it leaves the directory. Re-enabling restores it.', true);
                    if (reason) await run(api.setDisabled(account.accountId, true, reason), 'Account disabled');
                  }}>Disable account</Button>
                : <Button icon={<CheckCircleOutlined />} data-testid="admin-toggle-status" onClick={async () => {
                    const reason = await ask('Enable account', 'The account and its devices work again.');
                    if (reason) await run(api.setDisabled(account.accountId, false, reason), 'Account enabled');
                  }}>Enable account</Button>)}
              {can('RECOVERY_RESET') && (
                <div>
                  <Button icon={<KeyOutlined />} danger data-testid="admin-revoke-recovery" onClick={async () => {
                    const reason = await ask('Revoke recovery kit', 'Use when a recovery kit is lost or may be known to someone else. The old kit stops working at once; the person keeps their devices and Convo asks them to create a new kit. History on their devices is not affected.', true);
                    if (!reason) return;
                    try { const r = await api.revokeRecovery(account.accountId, reason); message.success(r.revoked ? 'Recovery kit revoked' : 'This person had no recovery kit'); changed(); }
                    catch (e) { message.error(errorText(e)); }
                  }}>Revoke recovery kit</Button>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                    Convo cannot read or recreate a recovery kit: it is created on the person's device. Revoking makes a lost kit useless; the person then creates a new one in Settings.
                  </Typography.Paragraph>
                </div>
              )}
              </>}
            </Space>) },
        ]} />
      )}
    </DetailSurface>
  );
}

function DetailSurface({ expanded, onClose, onMaximize, title, children }: {
  expanded: boolean; onClose: () => void; onMaximize?: () => void; title: ReactNode; children: ReactNode;
}) {
  const toggle = <Button type="text" icon={expanded ? <CompressOutlined /> : <ExpandOutlined />} onClick={onMaximize} aria-label={expanded ? 'Minimize view' : 'Maximize view'} data-testid="maximize-view" />;
  if (expanded) return <div data-testid="user-full-page"><div className="page-head"><Button icon={<ArrowLeftOutlined />} onClick={onClose}>Back to users</Button>{toggle}</div><Card title={title}>{children}</Card></div>;
  return <Drawer open onClose={onClose} width={720} destroyOnClose data-testid="user-drawer" title={title} extra={toggle}>{children}</Drawer>;
}
