import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Drawer, Empty, List, Segmented, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { DeleteOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { api, errorText, type AccountActivity, type AccountSummary, type DeviceSummary, type Permission } from '../api';
import { Chart } from './Chart';
import { fmtDay, fmtTime, LEVEL, nameOf, shortDay } from '../format';
import { useReason } from './confirm';
import { SignInPanel } from './SignInPanel';

/** Everything about one Convo account an administrator may see and do (never message content). */
export function UserDrawer({ accountId, onClose, can, onChanged }: { accountId: string | null; onClose: () => void; can: (p: Permission) => boolean; onChanged?: () => void }) {
  const { message } = App.useApp();
  const ask = useReason();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accountId) return;
    setError(null);
    if (can('STATS_READ')) void api.accountActivity(accountId, days).then((a) => { setActivity(a); setAccount(a.summary.account); }).catch((e) => setError(errorText(e)));
    else void api.accounts('').then((all) => setAccount(all.find((a) => a.accountId === accountId) ?? null)).catch((e) => setError(errorText(e)));
    if (can('DEVICES_READ')) void api.devices(accountId).then(setDevices).catch(() => setDevices([]));
  }, [accountId, days, can]);
  useEffect(() => { setAccount(null); setActivity(null); setDevices(null); }, [accountId]);
  useEffect(load, [load]);
  const changed = () => { load(); onChanged?.(); };
  const run = async (work: Promise<unknown>, done: string) => { try { await work; message.success(done); changed(); } catch (e) { message.error(errorText(e)); } };
  const loadSignIn = useCallback(() => api.signInOf(accountId!), [accountId]);
  const level = activity?.summary.level;
  return (
    <Drawer open={!!accountId} onClose={onClose} width={640} destroyOnClose data-testid="user-drawer"
      title={account ? <Space>{nameOf(account)}<Typography.Text type="secondary">@{account.username}</Typography.Text>
        {account.status === 'disabled' && <Tag color="red">Disabled</Tag>}{level && <Tag color={LEVEL[level].color}>{LEVEL[level].label}</Tag>}</Space> : 'Account'}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {!account ? <Spin /> : (
        <Tabs items={[
          ...(can('STATS_READ') ? [{ key: 'activity', label: 'Activity', children: (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ label: '30 days', value: 30 }, { label: '90 days', value: 90 }]} />
              {activity && <Descriptions column={2} bordered>
                <Descriptions.Item label="Encrypted items">{activity.summary.items}</Descriptions.Item>
                <Descriptions.Item label="Active days">{activity.summary.activeDays} of {activity.window}</Descriptions.Item>
                <Descriptions.Item label="Last active">{fmtDay(activity.summary.lastActiveDay)}</Descriptions.Item>
                <Descriptions.Item label="Last device activity">{fmtDay(account.lastSeenDay)}</Descriptions.Item>
              </Descriptions>}
              {activity && activity.days.length > 0 ? <Chart label={`Daily activity of ${account.username}`} height={220} option={(() => {
                const byDay = new Map(activity.days.map((d) => [d.day, d.items]));
                const axis: string[] = []; const values: number[] = [];
                for (let i = activity.window - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); axis.push(shortDay(d)); values.push(byDay.get(d) ?? 0); }
                return { xAxis: { type: 'category', data: axis }, yAxis: { type: 'value', minInterval: 1 },
                  series: [{ name: 'Encrypted items', type: 'bar', barMaxWidth: 12, itemStyle: { borderRadius: [3, 3, 0, 0] }, data: values }] };
              })()} /> : <Empty description="No activity in this period" />}
            </Space>) }] : []),
          ...(can('DEVICES_READ') ? [{ key: 'devices', label: `Devices${devices ? ` (${devices.length})` : ''}`, children: (
            <List data-testid="admin-device-list" dataSource={devices ?? []} locale={{ emptyText: 'No linked devices' }} renderItem={(d) => (
              <List.Item actions={can('DEVICE_REVOKE') ? [<Button key="r" size="small" danger icon={<DeleteOutlined />} data-testid="admin-revoke" onClick={async () => {
                const reason = await ask('Unlink device', `Device ${d.deviceId} (${d.platform}) is signed out at once and can no longer receive messages.`, true);
                if (reason) await run(api.revokeDevice(account.accountId, d.deviceId, reason), 'Device unlinked');
              }}>Unlink</Button>] : []}>
                <List.Item.Meta title={`${d.platform} · device ${d.deviceId}`} description={`Linked ${fmtTime(d.createdAt)} · last active ${fmtDay(d.lastSeenDay)}`} />
              </List.Item>)} />) }] : []),
          { key: 'signin', label: 'Sign-in', children: <SignInPanel load={loadSignIn} can={can} onChanged={changed} /> },
          { key: 'security', label: 'Security', children: (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
            </Space>) },
        ]} />
      )}
    </Drawer>
  );
}
