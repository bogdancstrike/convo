import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, List, Tag } from 'antd';
import { AndroidOutlined, DeleteOutlined, GlobalOutlined } from '@ant-design/icons';
import { api, errorText, type DeviceSummary, type Permission } from '../api';
import { useReason } from './confirm';
import { fmtDay, fmtTime } from '../format';

/**
 * A person's enrolled Convo devices (web and Android apps), next to their identity-provider sessions.
 * After enrollment the apps keep no sign-in session: every request is signed with the device's own
 * key, so they never appear among online sessions. Unlinking a device signs it out of Convo at once.
 */
export function ConvoDevicesCard({ accountId, can }: { accountId: string; can: (p: Permission) => boolean }) {
  const { message } = App.useApp();
  const ask = useReason();
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void api.devices(accountId).then((d) => { if (live) { setDevices(d); setError(null); } }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [accountId, version]);
  return (
    <Card className="table-surface" title={`Convo devices${devices ? ` (${devices.length})` : ''}`} data-testid="convo-devices">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Why the Convo apps are not among the sessions above"
        description="After a device is enrolled, the Convo web and Android apps keep no sign-in session: each request is signed with that device's own key. They are listed here instead. Unlinking signs the device out of Convo at once; ending sign-in sessions does not." />
      {error ? <Alert type="warning" showIcon message={error} /> : (
        <List loading={!devices} dataSource={devices ?? []} locale={{ emptyText: 'No linked devices' }} renderItem={(d) => (
          <List.Item data-testid={`convo-device-${d.deviceId}`} actions={can('DEVICE_REVOKE') ? [<Button key="u" size="small" danger icon={<DeleteOutlined />} onClick={async () => {
            const reason = await ask('Unlink device', `Device ${d.deviceId} (${d.platform}) is signed out at once and can no longer receive messages.`, true);
            if (!reason) return;
            try { await api.revokeDevice(accountId, d.deviceId, reason); message.success('Device unlinked'); setVersion((v) => v + 1); } catch (e) { message.error(errorText(e)); }
          }}>Unlink</Button>] : []}>
            <List.Item.Meta avatar={d.platform === 'android' ? <AndroidOutlined /> : <GlobalOutlined />}
              title={<>{d.platform === 'android' ? 'Android app' : d.platform === 'web' ? 'Web app' : d.platform} <Tag>device {d.deviceId}</Tag></>}
              description={`Linked ${fmtTime(d.createdAt)} · last active ${fmtDay(d.lastSeenDay)}`} />
          </List.Item>
        )} />
      )}
    </Card>
  );
}
