import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Select, Space, Typography } from 'antd';
import { api, errorText, type Integration } from '../api';
import { useReason } from './confirm';
import { fmtTime } from '../format';

/**
 * Marks a dedicated account as a visible archive or bot integration (FR-EXT-02, AC-INT-01/02).
 * Convo shows the mark wherever the account appears, asks before it joins a group and keeps a
 * banner in every chat it is in, with the retention text written here. There is no hidden mode.
 */
export function IntegrationSection({ accountId, editable }: { accountId: string; editable: boolean }) {
  const { message } = App.useApp();
  const ask = useReason();
  const [current, setCurrent] = useState<Integration | null | undefined>(undefined);
  const [kind, setKind] = useState<Integration['kind'] | 'none'>('none');
  const [retention, setRetention] = useState('');
  const load = () => void api.integration(accountId).then((r) => {
    // The server omits null fields: an ordinary account arrives without `integration`.
    setCurrent(r.integration ?? null); setKind(r.integration?.kind ?? 'none'); setRetention(r.integration?.retention ?? '');
  }).catch((e) => message.error(errorText(e)));
  useEffect(load, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (current === undefined) return null;
  const changed = (current?.kind ?? 'none') !== kind || (kind !== 'none' && (current?.retention ?? '') !== retention.trim());
  return (
    <div data-testid="integration-section">
      <Typography.Title level={5}>Integration account</Typography.Title>
      <Typography.Paragraph type="secondary">
        For a dedicated archive or bot account only. Everyone sees the label, is asked before adding it to a group, and sees a banner in every chat it is in with the retention text below. It reads what it receives, like any member.
      </Typography.Paragraph>
      {current && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Marked as ${current.kind} by ${current.setBy}, ${fmtTime(current.setAt)}`} />}
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select value={kind} onChange={setKind} disabled={!editable} style={{ width: 220 }} data-testid="integration-kind"
          options={[{ value: 'none', label: 'Ordinary account' }, { value: 'archive', label: 'Archive (keeps what it receives)' }, { value: 'bot', label: 'Bot' }]} />
        {kind !== 'none' && <Input.TextArea value={retention} onChange={(e) => setRetention(e.target.value)} maxLength={200} disabled={!editable} data-testid="integration-retention"
          placeholder="What happens to messages it receives, e.g. “Kept for 7 years for regulatory archiving.”" autoSize={{ minRows: 2 }} />}
        {editable && <Button type="primary" disabled={!changed || (kind !== 'none' && !retention.trim())} data-testid="integration-save" onClick={async () => {
          const reason = await ask(kind === 'none' ? 'Remove integration mark' : 'Mark as integration',
            kind === 'none' ? 'The label and banners disappear. It stays in the chats it is in.' : 'People in its chats see the label and banner from now on.', true);
          if (!reason) return;
          try { await api.setIntegration(accountId, kind === 'none' ? null : kind, retention.trim(), reason); message.success('Saved'); load(); }
          catch (e) { message.error(errorText(e)); }
        }}>Save</Button>}
      </Space>
    </div>
  );
}
