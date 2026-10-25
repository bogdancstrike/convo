import { useState } from 'react';
import { App, Checkbox, Form, Input, InputNumber, Modal, Space, Typography } from 'antd';
import { api, errorText } from '../api';
import { useSecret } from './confirm';
import { CREDENTIAL_LABELS, ROLE_LABELS } from '../format';

export function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const secret = useSecret();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Create user" okText="Create" onCancel={onClose} confirmLoading={busy} destroyOnClose
      okButtonProps={{ 'data-testid': 'create-user-submit' } as never} onOk={() => form.validateFields().then(async (v) => {
        setBusy(true);
        try {
          const base = { username: v.username.trim(), firstName: v.firstName ?? '', lastName: v.lastName ?? '', email: v.email ?? '', reason: v.reason.trim() };
          let expiresAt: string | undefined;
          const r = v.guest
            ? await api.createGuest({ ...base, days: v.guestDays }).then((g) => { expiresAt = g.expiresAt; return g; })
            : await api.createUser({ ...base, phone: v.phone ?? '', requirePasskey: !!v.requirePasskey });
          secret(`Created ${r.account.user.username}`, r.temporaryPassword, 'Give this temporary password to the person through a trusted channel. It is shown only now; they choose their own password at first sign-in.'
            + (expiresAt ? ` Guest access ends ${new Date(expiresAt).toLocaleString()}.` : ''));
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
        <Form.Item name="guest" valuePropName="checked" extra="Guests are labelled “Guest” in Convo. At expiry their sign-in and Convo account are disabled automatically.">
          <Checkbox data-testid="create-guest">Guest account (time-limited)</Checkbox>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.guest !== b.guest}>{({ getFieldValue }) => getFieldValue('guest')
          ? <Form.Item name="guestDays" label="Access for (days)" initialValue={30} rules={[{ required: true }]}><InputNumber min={1} max={365} data-testid="create-guest-days" /></Form.Item>
          : <>
              <Form.Item name="phone" label="Phone" extra="Convo asks for it at first sign-in when empty."><Input placeholder="+40 7…" data-testid="create-phone" /></Form.Item>
              <Form.Item name="requirePasskey" valuePropName="checked"><Checkbox data-testid="create-passkey">Require a passkey at first sign-in</Checkbox></Form.Item>
            </>}
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true }]} extra="Recorded in the audit log."><Input.TextArea rows={2} maxLength={500} data-testid="create-reason" /></Form.Item>
      </Form>
      <Typography.Text type="secondary">A temporary password is generated and shown once. Admin roles are granted separately ({Object.values(ROLE_LABELS).length} roles). Sign-in methods: {Object.values(CREDENTIAL_LABELS).slice(0, 3).join(', ')}.</Typography.Text>
    </Modal>
  );
}
