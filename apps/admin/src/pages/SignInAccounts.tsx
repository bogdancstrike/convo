import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Drawer, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { api, errorText, type SignInAccount } from '../api';
import { SignInPanel } from '../components/SignInPanel';
import { useSecret } from '../components/confirm';
import { CREDENTIAL_LABELS, fmtDay, ROLE_LABELS } from '../format';
import type { PageProps } from '../Shell';

/**
 * Sign-in accounts at the identity provider, including people who have not signed in to Convo yet:
 * create accounts, reset passwords, require a passkey or authenticator app, block sign-in.
 */
export function SignInPage({ can, navigate, param }: PageProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SignInAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => { setError(null); void api.idpUsers(query).then(setRows).catch((e) => { setRows([]); setError(errorText(e)); }); }, [query]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const loadOne = useCallback(() => api.idpUser(param), [param]);
  return (
    <div data-testid="admin-signin">
      <div className="page-head">
        <div><h1>Sign-in accounts</h1><p>Accounts at the organization's sign-in service. A Convo account is created when the person first signs in to Convo.</p></div>
        {can('USERS_CREATE') && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreating(true)} data-testid="admin-create-user">Create user</Button>}
      </div>
      {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Card>
        <Input.Search allowClear placeholder="Search username, name or email" style={{ width: 340, marginBottom: 12 }} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="idp-search" />
        <Table rowKey={(r) => r.user.id} size="middle" loading={!rows} dataSource={rows ?? []} pagination={{ pageSize: 25, hideOnSinglePage: true }}
          rowClassName={() => 'clickable-row'} onRow={(r) => ({ onClick: () => navigate(`sign-in/${r.user.id}`), 'data-testid': `idp-user-${r.user.username}` } as never)}
          columns={[
            { title: 'Username', key: 'u', render: (_, r) => <Space direction="vertical" size={0}><Typography.Text strong>{r.user.username}</Typography.Text>
              <Typography.Text type="secondary">{[r.user.firstName, r.user.lastName].filter(Boolean).join(' ') || r.user.email || ''}</Typography.Text></Space> },
            { title: 'Sign-in', key: 'e', width: 100, render: (_, r) => r.user.enabled ? <Tag color="green">Allowed</Tag> : <Tag color="red">Blocked</Tag> },
            { title: 'Convo', key: 'c', width: 150, render: (_, r) => r.convoAccountId ? <Tag color="blue">Active in Convo</Tag> : <Tag>Not signed in yet</Tag> },
            { title: 'Pending', key: 'p', render: (_, r) => r.user.requiredActions.length ? <Tag color="gold">{r.user.requiredActions.length} at next sign-in</Tag> : null },
            { title: 'Created', key: 't', width: 140, render: (_, r) => fmtDay(r.user.createdAt) },
          ]} />
      </Card>
      <Drawer open={!!param} width={600} onClose={() => navigate('sign-in')} destroyOnClose title="Sign-in account" data-testid="signin-drawer">
        {param && <SignInPanel load={loadOne} can={can} onChanged={load} />}
      </Drawer>
      <CreateUser open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); navigate(`sign-in/${id}`); }} />
    </div>
  );
}

function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const secret = useSecret();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Create user" okText="Create" onCancel={onClose} confirmLoading={busy} destroyOnClose
      okButtonProps={{ 'data-testid': 'create-user-submit' } as never} onOk={() => form.validateFields().then(async (v) => {
        setBusy(true);
        try {
          const r = await api.createUser({ username: v.username.trim(), firstName: v.firstName ?? '', lastName: v.lastName ?? '', email: v.email ?? '', phone: v.phone ?? '',
            requirePasskey: !!v.requirePasskey, reason: v.reason.trim() });
          secret(`Created ${r.account.user.username}`, r.temporaryPassword, 'Give this temporary password to the person through a trusted channel. It is shown only now; they choose their own password at first sign-in.');
          form.resetFields();
          onCreated(r.account.user.id);
        } catch (e) { message.error(errorText(e)); } finally { setBusy(false); }
      })}>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="username" label="Username" rules={[{ required: true, pattern: /^[A-Za-z0-9._-]{2,64}$/, message: 'Letters, digits, dot, dash or underscore' }]}>
          <Input autoFocus data-testid="create-username" />
        </Form.Item>
        <Space.Compact block>
          <Form.Item name="firstName" label="First name" style={{ flex: 1 }}><Input data-testid="create-first" /></Form.Item>
          <Form.Item name="lastName" label="Last name" style={{ flex: 1, marginLeft: 8 }}><Input data-testid="create-last" /></Form.Item>
        </Space.Compact>
        <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Phone" extra="Convo asks for it at first sign-in when empty."><Input placeholder="+40 7…" data-testid="create-phone" /></Form.Item>
        <Form.Item name="requirePasskey" valuePropName="checked"><Checkbox data-testid="create-passkey">Require a passkey at first sign-in</Checkbox></Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true }]} extra="Recorded in the audit log."><Input.TextArea rows={2} maxLength={500} data-testid="create-reason" /></Form.Item>
      </Form>
      <Typography.Text type="secondary">A temporary password is generated and shown once. Admin roles are granted separately ({Object.values(ROLE_LABELS).length} roles). Sign-in methods: {Object.values(CREDENTIAL_LABELS).slice(0, 3).join(', ')}.</Typography.Text>
    </Modal>
  );
}
