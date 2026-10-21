import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Card, Col, Drawer, Empty, Row, Space, Spin, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { ArrowRightOutlined, KeyOutlined } from '@ant-design/icons';
import { api, type AuditEntry, type Permission } from '../api';
import { CREDENTIAL_LABELS, fmtAgo, fmtTime, ROLE_LABELS } from '../format';
import { BRAND } from '../theme';
import { SignInSections, useSignIn } from './SignInPanel';

/**
 * One sign-in account in full (same layout as a person's drawer): who it is, how they sign in,
 * credential and session actions, admin roles, its audit trail and its Convo account.
 */
export function SignInDrawer({ id, onClose, can, onChanged, navigate }: {
  id: string | null; onClose: () => void; can: (p: Permission) => boolean; onChanged?: () => void; navigate: (route: string) => void;
}) {
  const load = useCallback(() => api.idpUser(id!), [id]);
  const state = useSignIn(load);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (id && can('AUDIT_READ')) void api.audit().then((all) => setAudit(all.filter((e) => e.target.includes(id) || (state.account?.convoAccountId && e.target.includes(state.account.convoAccountId))))).catch(() => setAudit([]));
  }, [id, can, state.account?.convoAccountId, version]);
  useEffect(() => setAudit(null), [id]);
  const changed = () => { state.refresh(); setVersion((v) => v + 1); onChanged?.(); };
  const u = state.account?.user;
  const name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username : '';
  return (
    <Drawer open={!!id} onClose={onClose} width={680} destroyOnClose data-testid="signin-drawer"
      title={u ? <Space><Avatar style={{ background: BRAND.ocean }}>{name.slice(0, 1).toUpperCase()}</Avatar><span>{name}</span>
        <Typography.Text type="secondary">@{u.username}</Typography.Text>{u.enabled ? <Tag color="green">Sign-in allowed</Tag> : <Tag color="red">Sign-in blocked</Tag>}</Space> : 'Sign-in account'}
      extra={state.account?.convoAccountId && can('ACCOUNTS_READ') && <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`users/${state.account!.convoAccountId}`)} data-testid="open-convo-account">Convo account</Button>}>
      {!u ? <Spin /> : (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col span={8}><Card size="small"><Statistic title="Sign-in methods" value={u.credentialTypes.length} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="Active sessions" value={u.sessions} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="Last activity" value={fmtAgo(u.lastAccess)} valueStyle={{ fontSize: 18 }} /></Card></Col>
          </Row>
          <Space wrap style={{ marginBottom: 12 }}>
            {u.credentialTypes.map((c) => <Tag key={c} icon={c.includes('webauthn') ? <KeyOutlined /> : undefined} color={c.includes('webauthn') ? 'blue' : undefined}>{CREDENTIAL_LABELS[c] ?? c}</Tag>)}
            {u.roles.map((r) => <Tag key={r} color="purple">{ROLE_LABELS[r] ?? r}</Tag>)}
            {state.account?.convoAccountId ? <Tag color="blue">Uses Convo</Tag> : <Tag>Not signed in to Convo yet</Tag>}
          </Space>
          <Tabs items={[
            { key: 'overview', label: 'Overview', children: <SignInSections {...state} can={can} onChanged={changed} sections={['details']} /> },
            { key: 'security', label: 'Security', children: <SignInSections {...state} can={can} onChanged={changed} sections={['actions']} /> },
            { key: 'roles', label: 'Roles', children: <SignInSections {...state} can={can} onChanged={changed} sections={['roles']} /> },
            ...(can('AUDIT_READ') ? [{ key: 'audit', label: `Audit${audit ? ` (${audit.length})` : ''}`, children: audit === null ? <Spin /> : audit.length === 0
              ? <Empty description="No administrative actions on this account yet" /> : (
                <Table rowKey="seq" size="middle" dataSource={audit} pagination={{ pageSize: 10, hideOnSinglePage: true }} data-testid="signin-audit" columns={[
                  { title: 'When', dataIndex: 'at', width: 160, render: fmtTime },
                  { title: 'Action', dataIndex: 'action', render: (a: string) => <Tag color={a.startsWith('denied:') ? 'red' : 'blue'}>{a}</Tag> },
                  { title: 'By', dataIndex: 'actor', ellipsis: true },
                  { title: 'Reason', dataIndex: 'reason', ellipsis: true },
                ]} />) }] : []),
          ]} />
        </>
      )}
    </Drawer>
  );
}
