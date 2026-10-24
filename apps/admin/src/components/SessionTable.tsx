import { useEffect, useState } from 'react';
import { Alert, App, Button, Space, Tag, Typography } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { api, errorText, type LiveSession, type Permission } from '../api';
import { AdminTable } from './AdminTable';
import { useReason } from './confirm';
import { fmtTime } from '../format';

export const SESSION_NOTE = 'Ending a sign-in session prevents token refresh. Existing access tokens can remain valid until expiry. Linked messaging devices stay linked; use Unlink device to revoke device access.';

export function SessionTable({ userId, can, onOpen }: { userId: string; can: (permission: Permission) => boolean; onOpen: (session: LiveSession) => void }) {
  const [version, setVersion] = useState(0);
  const { message } = App.useApp();
  const ask = useReason();
  useEffect(() => { const timer = setInterval(() => setVersion((v) => v + 1), 15_000); return () => clearInterval(timer); }, []);
  const endAll = async () => {
    const reason = await ask('End all sign-in sessions', SESSION_NOTE, true);
    if (!reason) return;
    try { await api.signOutEverywhere(userId, reason); message.success('Sign-in sessions ended'); setVersion((v) => v + 1); } catch (e) { message.error(errorText(e)); }
  };
  return <div className="sessions-panel" data-testid="sessions-panel">
    <div className="session-context"><Typography.Text type="secondary">Live online sessions · refreshed every 15 seconds</Typography.Text>{can('SESSIONS_REVOKE') && <Button danger icon={<LogoutOutlined />} onClick={() => void endAll()} data-testid="end-all-sessions">End all sessions</Button>}</div>
    <Alert type="info" showIcon message="Sign-in sessions and messaging devices have separate lifecycles" description={SESSION_NOTE} />
    <AdminTable<LiveSession> key={userId} id="live-sessions" resource="sessions" scope={{ user: userId }} rowKey="id" defaultSize={10} defaultSort="lastAccess" defaultOrder="desc" refreshKey={version} testId="sessions-table" searchId="sessions-search" searchPlaceholder="Search browser, app or source IP" onRow={(s) => ({ onClick: () => onOpen(s), style: { cursor: 'pointer' } })} columns={[
      { title: 'Person', key: 'username', render: (_, s) => <Button type="link" className="person-link" title={s.username} onClick={() => onOpen(s)}>{s.username}</Button> },
      { title: 'Browser / device', key: 'browser', render: (_, s) => <Space direction="vertical" size={0}><Typography.Text>{s.browser}</Typography.Text><Typography.Text type="secondary">{s.operatingSystem}{s.current && <Tag color="blue">Current</Tag>}</Typography.Text></Space> },
      { title: 'Applications', key: 'clients', render: (_, s) => s.clients.join(', ') || 'Not reported' },
      { title: 'Source IP', key: 'ipAddress', dataIndex: 'ipAddress', render: (value) => value || 'Not reported' },
      { title: 'Signed in', key: 'startedAt', render: (_, s) => fmtTime(s.startedAt) },
      { title: 'Last activity', key: 'lastAccess', render: (_, s) => fmtTime(s.lastAccess) },
    ]} />
  </div>;
}
