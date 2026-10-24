import { Popover, Typography } from 'antd';
/** Usernames first; the signed identifier stays available for investigations and copies. */
export function AuditIdentity({ name, raw }: { name?: string; raw: string }) {
  const fallback = raw.match(/\(([^)]+)\)/)?.[1] ?? (/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(raw) ? 'Unavailable account' : raw);
  return <Popover title="Recorded identity" content={<Typography.Text code copyable style={{ overflowWrap: 'anywhere', maxWidth: 400 }}>{raw}</Typography.Text>} trigger={['hover', 'click']}>
    <Typography.Text className="audit-identity" tabIndex={0}>{name ?? fallback}</Typography.Text>
  </Popover>;
}
