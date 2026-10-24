import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Drawer, Empty, Select, Space, Spin, Typography } from 'antd';
import { ArrowLeftOutlined, CompressOutlined, ExpandOutlined, LogoutOutlined } from '@ant-design/icons';
import { api, errorText, type LiveSession, type SignInAccount } from '../api';
import { SessionTable, SESSION_NOTE } from '../components/SessionTable';
import { useViewState } from '../components/useViewState';
import { useReason } from '../components/confirm';
import { fmtTime } from '../format';
import type { PageProps } from '../Shell';

export function SessionsPage({ can, navigate, param }: PageProps) {
  const { view, update, link } = useViewState({ user: '', display: '' });
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<SignInAccount[]>([]);
  const [selected, setSelected] = useState<SignInAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [detail, setDetail] = useState<LiveSession | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { message } = App.useApp(); const ask = useReason();
  useEffect(() => {
    let active = true; const timer = setTimeout(() => { void api.idpUsers(query).then((p) => { if (active) { setPeople(p); setError(null); } }).catch((e) => { if (active) setError(errorText(e)); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  useEffect(() => { let active = true; setSelected(null); if (view.user) void api.idpUser(view.user).then((p) => { if (active) setSelected(p); }).catch((e) => { if (active) setError(errorText(e)); }); return () => { active = false; }; }, [view.user]);
  useEffect(() => {
    let active = true; setDetail(null); setDetailError(null);
    if (param && view.user) void api.table<LiveSession>('sessions', { user: view.user }, { q: '', sort: '', order: 'asc', page: 1, size: 10, filters: { id: param } }).then((r) => {
      if (active) { const session = r.rows.find((s) => s.id === param); setDetail(session ?? null); if (!session) setDetailError('This session is no longer active.'); }
    }).catch((e) => { if (active) setDetailError(errorText(e)); });
    else if (param) setDetailError('Select the person this session belongs to.');
    return () => { active = false; };
  }, [param, view.user]);
  const close = () => navigate(link('sessions'));
  const open = (s: LiveSession) => navigate(link(`sessions/${s.id}`));
  const expanded = view.display === 'page';
  const toggle = <Button type="text" icon={expanded ? <CompressOutlined /> : <ExpandOutlined />} aria-label={expanded ? 'Minimize view' : 'Maximize view'} onClick={() => update({ display: expanded ? '' : 'page' })} />;
  const content = <div className="security-detail-content">{detailError ? <Alert type="warning" showIcon message={detailError} /> : detail ? <>
    <Typography.Paragraph type="secondary">{detail.current ? 'This is your current sign-in session.' : 'An active online session reported by the identity provider.'}</Typography.Paragraph>
    <Descriptions column={1} bordered size="small" items={[
      { key: 'person', label: 'Person', children: detail.username }, { key: 'browser', label: 'Browser', children: detail.browser }, { key: 'os', label: 'Device OS', children: detail.operatingSystem },
      { key: 'ip', label: 'Source IP reported by Keycloak', children: detail.ipAddress || 'Not reported' }, { key: 'apps', label: 'Applications', children: detail.clients.join(', ') },
      { key: 'start', label: 'Signed in', children: fmtTime(detail.startedAt) }, { key: 'last', label: 'Last identity-provider activity', children: fmtTime(detail.lastAccess) },
      { key: 'observed', label: 'Browser metadata observed', children: fmtTime(detail.observedAt) },
    ]} />
    <Alert type="info" showIcon message="Browser and OS are self-reported metadata" description="They are observed on authenticated requests. Older sessions may have no observation. This does not identify a linked encrypted device." />
    <Typography.Paragraph type="secondary">{SESSION_NOTE}</Typography.Paragraph>
    {can('SESSIONS_REVOKE') && <Button danger icon={<LogoutOutlined />} data-testid="end-session" onClick={async () => {
      const reason = await ask(detail.current ? 'End your current session' : 'End this sign-in session', SESSION_NOTE, true); if (!reason) return;
      try { await api.endSession(detail.userId, detail.id, reason); message.success('Sign-in session ended'); setVersion((v) => v + 1); close(); } catch (e) { message.error(errorText(e)); }
    }}>End session</Button>}
    {can('ACCOUNTS_READ') && <Button onClick={() => navigate(`users/sign-in/${detail.userId}/security?display=page`)}>Manage this person</Button>}
  </> : <Spin />}</div>;
  if (param && expanded) return <div className="page-frame"><div className="page-head"><Space><Button icon={<ArrowLeftOutlined />} onClick={close}>Back to sessions</Button><h1>Session details</h1></Space>{toggle}</div><Card className="security-detail-page">{content}</Card></div>;
  const options = [...new Map([...(selected ? [selected] : []), ...people].map((p) => [p.user.id, p])).values()].map((p) => ({ value: p.user.id, label: `${p.user.username} · ${[p.user.firstName, p.user.lastName].filter(Boolean).join(' ')}` }));
  return <div className="page-frame page-sessions" data-testid="admin-sessions"><div className="page-head"><div><h1>Live sessions</h1><p>Inspect a person’s active sign-ins and end access to individual sessions.</p></div></div>
    <Card size="small" className="sessions-scope"><div className="session-person-picker"><div><Typography.Text strong>Select a person</Typography.Text><Typography.Paragraph type="secondary">Search by name or username</Typography.Paragraph></div><Select showSearch allowClear filterOption={false} aria-label="Select a person for sessions" placeholder="Find a person" value={view.user || undefined} onSearch={setQuery} onChange={(value) => { setQuery(''); navigate(`sessions${value ? `?user=${encodeURIComponent(value)}` : ''}`); }} options={options} /></div></Card>
    {error && <Alert type="error" showIcon message={error} />}
    {view.user ? <Card className="table-surface" title={selected ? `${selected.user.username} · online sessions` : 'Online sessions'}><SessionTable key={`${view.user}:${version}`} userId={view.user} can={can} onOpen={open} /></Card> : <Card><Empty description="Choose a person to inspect their live sessions" /></Card>}
    {param && <Drawer open width={660} title="Session details" onClose={close} extra={toggle} destroyOnHidden>{content}</Drawer>}
  </div>;
}
