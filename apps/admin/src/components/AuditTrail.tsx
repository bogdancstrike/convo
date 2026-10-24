import { Tag } from 'antd';
import type { AuditEntry } from '../api';
import { fmtTime } from '../format';
import { AuditIdentity } from './AuditIdentity';
import { AdminTable } from './AdminTable';

/** User-scoped queries search and sort the complete audit source at the backend. */
export function AuditTrail({ subjects, version = 0 }: { subjects: string[]; version?: number }) {
  return <div className="drawer-audit"><AdminTable<AuditEntry> id="user-audit" resource="audit" minWidth={1050} rowKey="seq" scope={{ user: subjects.filter(Boolean).join(',') }} defaultSort="seq" defaultOrder="desc" defaultSize={10} refreshKey={version} testId="signin-audit" columns={[
    { title: 'When', dataIndex: 'at', key: 'at', width: 165, render: fmtTime },
    { title: 'Action', dataIndex: 'action', key: 'action', width: 180, render: (action: string) => <Tag>{action}</Tag> },
    { title: 'Who', dataIndex: 'actor', key: 'actor', width: 190, render: (raw: string, row) => <AuditIdentity raw={raw} name={row.actorName} /> },
    { title: 'Target', dataIndex: 'target', key: 'target', width: 200, render: (raw: string, row) => <AuditIdentity raw={raw} name={row.targetName} /> },
    { title: 'Details', dataIndex: 'reason', key: 'reason', ellipsis: true },
  ]} /></div>;
}
