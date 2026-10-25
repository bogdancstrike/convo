import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, InputNumber, Select, Space, Spin, Switch, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { AdminError, api, errorText, type OrgPolicy } from '../api';
import { useReason } from '../components/confirm';
import { fmtTime } from '../format';
import type { PageProps } from '../Shell';

/**
 * Organization policy (specs §19.1, AC-ADM-02): what Convo apps enforce on every device. Each save
 * publishes a new version signed by the server's policy key; devices verify the signature and pin
 * the key. Saving a policy someone else changed meanwhile is refused, so nobody overwrites an edit
 * they have not seen.
 */
export function PolicyPage({ can }: PageProps) {
  const { message } = App.useApp();
  const ask = useReason();
  const [form] = Form.useForm<OrgPolicy>();
  const [state, setState] = useState<Awaited<ReturnType<typeof api.policy>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('POLICY_MANAGE');
  const load = useCallback(() => api.policy().then((s) => { setState(s); form.setFieldsValue(s.policy); setError(null); }).catch((e) => setError(errorText(e))), [form]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!state) return <Spin />;
  const save = async () => {
    const policy = await form.validateFields();
    const reason = await ask(`Publish policy version ${state.version + 1}`, 'Every Convo device applies it at its next check (within 15 minutes, or when it opens).');
    if (!reason) return;
    setBusy(true);
    try {
      const published = await api.publishPolicy(state.version, policy, reason);
      message.success(`Policy version ${published.version} published`);
      await load();
    } catch (e) {
      if (e instanceof AdminError && e.status === 409) { message.warning('Someone published a newer version meanwhile. It has been loaded: review it and save again.'); await load(); }
      else message.error(errorText(e));
    } finally { setBusy(false); }
  };
  const row = (name: (string | number)[], label: string, help: string) => (
    <Form.Item name={name} label={label} valuePropName="checked" extra={help}><Switch disabled={!editable} data-testid={`policy-${name.join('-')}`} /></Form.Item>
  );
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }} data-testid="policy-page">
      <Typography.Title level={3} style={{ margin: 0 }}><SafetyCertificateOutlined /> Organization policy</Typography.Title>
      <Alert type="info" showIcon message="Enforced by Convo apps, not by cryptography"
        description="Every device verifies the policy's signature and applies it. A modified app could ignore it, so treat these controls as governance. Server-enforced limits (edit windows, attachment size) are deployment settings and are not listed here." />
      <Descriptions bordered size="small" column={1} data-testid="policy-version">
        <Descriptions.Item label="Version in force">{state.version || 'none published (defaults apply)'}</Descriptions.Item>
        {state.signed && <Descriptions.Item label="Published">{fmtTime(state.signed.publishedAt)} by {state.signed.publishedBy}</Descriptions.Item>}
        {state.signed && <Descriptions.Item label="Signing key">{state.signed.keyId}</Descriptions.Item>}
      </Descriptions>
      <Form form={form} layout="vertical" disabled={!editable}>
        <Card title="Notifications" size="small">
          <Form.Item name={['notifications', 'maxPreview']} label="Most detailed preview" extra="Devices cannot show more than this in system notifications.">
            <Select data-testid="policy-max-preview" options={[{ value: 'generic', label: 'Hidden (“New message”)' }, { value: 'sender', label: 'Sender only' }, { value: 'full', label: 'Sender and text' }]} style={{ maxWidth: 280 }} />
          </Form.Item>
        </Card>
        <Card title="Device security" size="small" style={{ marginTop: 16 }}>
          {row(['security', 'appLockRequired'], 'Require the app lock', 'People must lock Convo with a passkey (web) or biometrics (Android) and cannot turn it off.')}
          <Form.Item name={['security', 'appLockMaxMinutes']} label="Longest delay before the lock engages (minutes)"><InputNumber min={0} max={60} data-testid="policy-lock-minutes" /></Form.Item>
          {row(['security', 'screenshotBlock'], 'Block screenshots on Android', 'Screenshots and screen recordings of Convo show a black screen.')}
        </Card>
        <Card title="Privacy defaults for new devices" size="small" style={{ marginTop: 16 }}>
          {row(['privacy', 'readReceiptsDefault'], 'Read receipts on', 'Applied to devices enrolled in the last day when they first receive a policy; people can change it.')}
          {row(['privacy', 'typingDefault'], 'Typing indicators on', 'Applied to devices enrolled in the last day when they first receive a policy; people can change it.')}
        </Card>
        <Card title="Features" size="small" style={{ marginTop: 16 }}>
          {row(['features', 'chatExport'], 'Chat export', 'Exporting a readable (unencrypted) copy of a chat.')}
          {row(['features', 'viewOnce'], 'View-once photos and videos', 'Sending media that can be opened once.')}
          {row(['features', 'stickers'], 'Stickers', 'The bundled sticker packs.')}
          {row(['features', 'callLinks'], 'Call links', 'Members sharing links that join a group call.')}
        </Card>
      </Form>
      {editable ? <Button type="primary" loading={busy} onClick={() => void save()} data-testid="policy-publish">Publish new version</Button>
        : <Alert type="info" showIcon message="Your admin role can view the policy but not change it." />}
    </Space>
  );
}
