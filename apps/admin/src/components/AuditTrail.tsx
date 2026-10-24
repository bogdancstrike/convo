import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Space, Table, Tag } from 'antd';
import { api, errorText, type AuditEntry } from '../api';
import { AuditIdentity } from './AuditIdentity';
import { fmtTime } from '../format';

/** Account-scoped audit, filtered by the server across all history. */
export function AuditTrail({ subjects, version = 0 }: { subjects: string[]; version?: number }) {
  const user = subjects.filter(Boolean).join(',');
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [before, setBefore] = useState<number | undefined>();
  useEffect(() => { setRows([]); setBefore(undefined); }, [user, version]);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(null);
    void api.audit({ user, before }).then((r) => { if (active) { setRows((old) => before ? [...old.filter((e) => !r.some((n) => n.seq === e.seq)), ...r] : r); setMore(r.length === 100); } })
      .catch((e) => { if (active) setError(errorText(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [user, version, before]);
  return <Space direction="vertical" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} showIcon />}
    <Table rowKey="seq" loading={busy} dataSource={rows} size="middle" locale={{ emptyText: <Empty description="No recorded actions for this user" /> }} pagination={{ pageSize: 10, hideOnSinglePage: true }} data-testid="signin-audit" columns={[
      { title: 'When', dataIndex: 'at', width: 160, render: fmtTime }, { title: 'Action', dataIndex: 'action', render: (a: string) => <Tag>{a}</Tag> },
      { title: 'By', dataIndex: 'actor', render: (raw: string, row) => <AuditIdentity name={row.actorName} raw={raw} /> }, { title: 'Details', dataIndex: 'reason', ellipsis: true },
    ]} />
    {more && <Button loading={busy} onClick={() => setBefore(rows.at(-1)?.seq)}>Load older events</Button>}
  </Space>;
}
