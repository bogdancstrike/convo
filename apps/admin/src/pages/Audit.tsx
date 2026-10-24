import { useEffect, useState } from 'react';
import { Alert, App, Button, AutoComplete, Card, DatePicker, Popover, Select, Space, Tag, Typography } from 'antd';
import { CloudDownloadOutlined, SafetyCertificateOutlined, SaveOutlined, ReloadOutlined, FilterOutlined } from '@ant-design/icons';
import { api, errorText, type AuditEntry, type AuditSource, type AuditVerification } from '../api';
import dayjs from 'dayjs';
import { useViewState } from '../components/useViewState';
import { AdminTable } from '../components/AdminTable';
import { AuditIdentity } from '../components/AuditIdentity';
import { useReason } from '../components/confirm';
import { fmtTime } from '../format';
import type { PageProps } from '../Shell';

const COLORS: Record<string, string> = { auth: 'green', passkey: 'cyan', credential: 'purple', profile: 'blue', privacy: 'blue', group: 'default', community: 'default', call: 'default', account: 'blue', device: 'orange', user: 'geekblue', role: 'purple', recovery: 'magenta', push: 'cyan', audit: 'default', admin: 'default' };

/** The hash-chained audit log: every administrative change with its reason, verifiable and exportable. */
export function AuditPage({ can }: PageProps) {
  const { message } = App.useApp();
  const ask = useReason();
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const { view, update } = useViewState({ search: '', category: 'all', user: '', userQuery: '', from: '', to: '', before: '', page: '1', size: '50' });
  const kind = view.category, user = view.user, userQuery = view.userQuery;
  const range = view.from && view.to ? [view.from, view.to] : null;
  const [version, setVersion] = useState(0);
  const [userOptions, setUserOptions] = useState<{ value: string; label: string }[]>([]);
  const [source, setSource] = useState<AuditSource | null>(null);
  const load = () => setVersion((v) => v + 1);
  useEffect(() => { let active = true; void api.auditSources().then((s) => { if (active) setSource(s); }).catch(() => { if (active) setSource(null); }); return () => { active = false; }; }, [version]);
  useEffect(() => {
    let active = true;
    if (!can('ACCOUNTS_READ')) return;
    const timer = setTimeout(() => void api.idpUsers(userQuery).then((rows) => { if (active) setUserOptions(rows.map((r) => ({ value: [r.user.id, r.convoAccountId].filter(Boolean).join(','), label: r.user.username }))); }).catch(() => { if (active) setUserOptions([]); }), 250);
    return () => { active = false; clearTimeout(timer); };
  }, [userQuery, can]);
  return (
    <div className="page-frame page-audit" data-testid="admin-audit">
      <div className="page-head">
        <div><h1>Audit log</h1><p>Sign-ins, sign-outs, devices, passkeys, account changes and administrative actions, with who, when and why. Each entry's hash covers the previous one, and chain heads are written to an independent checkpoint file, so a database rewrite is detected.</p></div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
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
      <Alert style={{ marginBottom: 16 }} showIcon type={source?.error || source?.configured === false ? 'warning' : 'info'}
        message={source?.error ?? (source?.configured === false ? 'Identity audit is not configured. Configure the admin operations service account to capture sign-in and credential events.' : source?.lastSuccess ? `Identity events synced ${fmtTime(source.lastSuccess)} · refresh to see new events` : 'Identity event sync is awaiting its first successful poll.')}
 />
      {verification && <Alert style={{ marginBottom: 16 }} showIcon data-testid="admin-verification" type={verification.valid ? 'success' : 'error'}
        message={verification.valid ? `Chain intact · ${verification.entries} entries · ${verification.checkpointsChecked} checkpoints match`
          : verification.checkpointMismatchSeq ? `Database disagrees with the independent checkpoint at entry ${verification.checkpointMismatchSeq}` : `Chain broken at entry ${verification.firstBrokenSeq}`}
        description={<Typography.Text code copyable style={{ fontSize: 12 }}>{verification.head}</Typography.Text>} />}
      <Card className="table-surface">
        <AdminTable<AuditEntry> id="audit" resource="audit" rowKey="seq" defaultSort="seq" defaultOrder="desc" defaultSize={50} refreshKey={version} searchId="audit-search" searchPlaceholder="Search actor, action, target or reason"
          scope={{ action: kind === 'all' ? '' : kind, user, from: view.from, to: view.to }} controls={<Popover trigger="click" title="Audit filters" placement="bottomLeft" content={<Space style={{ marginBottom: 12 }} wrap>
          <Select aria-label="Audit action category" value={kind} onChange={(category) => update({ category, before: '', page: '1' })} style={{ width: 180 }} options={[{ value: 'all', label: 'All actions' }, { value: 'denied', label: 'Refused attempts' }, ...Object.keys(COLORS).map((k) => ({ value: k, label: k === 'auth' ? 'Sign-in & sessions' : k === 'passkey' ? 'Passkeys' : k.charAt(0).toUpperCase() + k.slice(1) }))]} />
          {can('ACCOUNTS_READ') && <AutoComplete allowClear aria-label="Filter audit by user" placeholder="Filter by user" value={userQuery} options={userOptions} style={{ width: 230 }}
            onChange={(userQuery) => update({ userQuery, user: '', before: '', page: '1' }, true)} onSelect={(user: string, option) => update({ user, userQuery: String(option.label), before: '', page: '1' })} />}
          <DatePicker.RangePicker aria-label="Audit date range" value={range ? [dayjs(range[0]), dayjs(range[1])] : null} onChange={(v) => update({ from: v?.[0] ? dayjs(v[0]).startOf('day').toISOString() : '', to: v?.[1] ? dayjs(v[1]).endOf('day').toISOString() : '', before: '', page: '1' })} />
        </Space>}><Button icon={<FilterOutlined />}>Filters{(kind !== 'all' || user || view.from) ? ' · active' : ''}</Button></Popover>}
          onRow={() => ({ 'data-testid': 'admin-audit-entry' } as never)}
          columns={[
            { title: '#', dataIndex: 'seq', width: 64 },
            { title: 'When', dataIndex: 'at', width: 170, render: fmtTime },
            { title: 'Who', dataIndex: 'actor', width: 220, render: (raw: string, row) => <AuditIdentity name={row.actorName} raw={raw} /> },
            { title: 'Action', dataIndex: 'action', width: 200, render: (a: string) => a.startsWith('denied:')
              ? <Tag color="red">refused · {a.slice(7)}</Tag> : <Tag color={COLORS[a.split('.')[0] ?? ''] ?? 'default'}>{a}</Tag> },
            { title: 'Target', dataIndex: 'target', render: (raw: string, row) => <AuditIdentity name={row.targetName} raw={raw} /> },
            { title: 'Reason', dataIndex: 'reason', width: 320, ellipsis: true },
          ]} />
      </Card>
    </div>
  );
}
