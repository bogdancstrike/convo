import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { CloudDownloadOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import { api, errorText, type AuditEntry, type AuditVerification } from '../api';
import { useReason } from '../components/confirm';
import { fmtTime } from '../format';
import type { PageProps } from '../Shell';

const COLORS: Record<string, string> = { account: 'blue', device: 'orange', user: 'geekblue', role: 'purple', recovery: 'magenta', push: 'cyan', audit: 'default', admin: 'default' };

/** The hash-chained audit log: every administrative change with its reason, verifiable and exportable. */
export function AuditPage({ can }: PageProps) {
  const { message } = App.useApp();
  const ask = useReason();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const load = () => void api.audit().then(setEntries).catch((e) => setError(errorText(e)));
  useEffect(load, []);
  const kinds = useMemo(() => [...new Set((entries ?? []).map((e) => e.action.replace(/^denied:/, '').split('.')[0] ?? ''))].sort(), [entries]);
  const shown = (entries ?? []).filter((e) => (kind === 'all' || e.action.replace(/^denied:/, '').startsWith(`${kind}.`) || (kind === 'denied' && e.action.startsWith('denied:')))
    && (!text.trim() || `${e.actor} ${e.action} ${e.target} ${e.reason}`.toLowerCase().includes(text.trim().toLowerCase())));
  return (
    <div data-testid="admin-audit">
      <div className="page-head">
        <div><h1>Audit log</h1><p>Every administrative action and refused attempt, with who, when and why. Each entry's hash covers the previous one, and chain heads are written to an independent checkpoint file, so a database rewrite is detected.</p></div>
        <Space wrap>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => void api.verify().then(setVerification).catch((e) => message.error(errorText(e)))} data-testid="admin-verify">Verify chain</Button>
          {can('AUDIT_CHECKPOINT') && <Button icon={<SaveOutlined />} onClick={() => void api.checkpoint().then(setVerification).catch((e) => message.error(errorText(e)))} data-testid="admin-checkpoint">Checkpoint now</Button>}
          {can('AUDIT_EXPORT') && <Button icon={<CloudDownloadOutlined />} data-testid="admin-export" onClick={async () => {
            const reason = await ask('Export the audit log', 'The export itself is recorded in the audit log, with this reason, before the file is created.');
            if (!reason) return;
            try {
              const data = await api.exportAudit(reason);
              const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
              const a = document.createElement('a'); a.href = url; a.download = `convo-audit-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
              load();
            } catch (e) { message.error(errorText(e)); }
          }}>Export</Button>}
        </Space>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {verification && <Alert style={{ marginBottom: 16 }} showIcon data-testid="admin-verification" type={verification.valid ? 'success' : 'error'}
        message={verification.valid ? `Chain intact · ${verification.entries} entries · ${verification.checkpointsChecked} checkpoints match`
          : verification.checkpointMismatchSeq ? `Database disagrees with the independent checkpoint at entry ${verification.checkpointMismatchSeq}` : `Chain broken at entry ${verification.firstBrokenSeq}`}
        description={<Typography.Text code copyable style={{ fontSize: 12 }}>{verification.head}</Typography.Text>} />}
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search allowClear placeholder="Search actor, action, target or reason" style={{ width: 340 }} value={text} onChange={(e) => setText(e.target.value)} data-testid="audit-search" />
          <Select value={kind} onChange={setKind} style={{ width: 180 }} options={[{ value: 'all', label: 'All actions' }, { value: 'denied', label: 'Refused attempts' }, ...kinds.map((k) => ({ value: k, label: k }))]} />
          <Typography.Text type="secondary">{shown.length} entries</Typography.Text>
        </Space>
        <Table rowKey="seq" size="small" loading={!entries} dataSource={shown} pagination={{ pageSize: 50, hideOnSinglePage: true }}
          onRow={() => ({ 'data-testid': 'admin-audit-entry' } as never)}
          columns={[
            { title: '#', dataIndex: 'seq', width: 64 },
            { title: 'When', dataIndex: 'at', width: 170, render: fmtTime },
            { title: 'Who', dataIndex: 'actor', width: 220, ellipsis: true },
            { title: 'Action', dataIndex: 'action', width: 200, render: (a: string) => a.startsWith('denied:')
              ? <Tag color="red">refused · {a.slice(7)}</Tag> : <Tag color={COLORS[a.split('.')[0] ?? ''] ?? 'default'}>{a}</Tag> },
            { title: 'Target', dataIndex: 'target', ellipsis: true },
            { title: 'Reason', dataIndex: 'reason', ellipsis: true },
          ]} />
      </Card>
    </div>
  );
}
