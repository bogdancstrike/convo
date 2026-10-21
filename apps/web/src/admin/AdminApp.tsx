import { useCallback, useEffect, useState } from 'react';
import { AdminApi, AdminError, type AccountSummary, type AuditEntry, type AuditVerification, type DeviceSummary, type Health, type Permission } from './adminApi';

/**
 * Organization admin console (ADM-01, first slice): find accounts, disable/enable them, revoke
 * devices — each with a mandatory reason — and inspect/verify the hash-chained audit log.
 * English-only operator tool; production deployments serve it from a separate origin.
 */
export function AdminApp() {
  const [api, setApi] = useState<AdminApi | null>(null);
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'accounts' | 'audit' | 'health'>('accounts');
  const [me, setMe] = useState<{ roles: string[]; permissions: Permission[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void AdminApi.create().then(async (a) => { setApi(a); setAdmin(await a.session()); }).catch(() => setError('The server is unreachable.')); }, []);
  // Least privilege (AC-ADM-01): show only what this admin's roles allow; the server enforces it.
  useEffect(() => {
    if (!api || !admin) return;
    void api.me().then((m) => { setMe(m); if (!m.permissions.includes('ACCOUNTS_READ')) setTab(m.permissions.includes('AUDIT_READ') ? 'audit' : 'health'); }).catch(() => setMe({ roles: [], permissions: [] }));
  }, [api, admin]);
  const can = (p: Permission) => !!me?.permissions.includes(p);
  const [stepUp, setStepUp] = useState(false);
  const fail = useCallback((e: unknown) => { setStepUp(e instanceof AdminError && e.code === 'STEP_UP_REQUIRED'); setError(e instanceof AdminError && e.code === 'STEP_UP_REQUIRED' ? 'For your protection, sign in again to confirm this change.'
    : e instanceof AdminError && e.status === 403 ? 'Your admin role does not allow this. The attempt was recorded.'
    : e instanceof AdminError && e.status === 401 ? 'Your session expired. Sign in again.' : 'The request failed.'); }, []);
  if (admin === undefined) return <main className="admin"><p role="status">Loading…</p>{error && <p role="alert">{error}</p>}</main>;
  if (!admin || !api) {
    return (
      <main className="admin admin-login">
        <img src="/logo.svg" alt="" width={64} height={64} />
        <h1>Convo Admin</h1>
        <p>Organization administration. Sign in with an account that has the administrator role.</p>
        <button className="btn btn-primary" onClick={() => void api?.signIn()} data-testid="admin-sign-in">Sign in</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }
  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Convo Admin</h1>
        <nav className="chips">
          {can('ACCOUNTS_READ') && <button className="chip" aria-pressed={tab === 'accounts'} onClick={() => setTab('accounts')} data-testid="admin-tab-accounts">Accounts</button>}
          {can('AUDIT_READ') && <button className="chip" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')} data-testid="admin-tab-audit">Audit log</button>}
          {can('HEALTH_READ') && <button className="chip" aria-pressed={tab === 'health'} onClick={() => setTab('health')} data-testid="admin-tab-health">Health</button>}
        </nav>
        <span className="muted-text" data-testid="admin-name">{admin}</span>
        <span className="muted-text" data-testid="admin-roles">{me?.roles.join(', ')}</span>
        <button className="btn" onClick={() => void api.signOut().then(() => setAdmin(null))}>Sign out</button>
      </header>
      {error && <p role="alert" className="failed" data-testid="admin-error">{error}</p>}
      {stepUp && <button className="btn btn-primary" onClick={() => void api.signIn()} data-testid="admin-step-up">Sign in again</button>}
      {me && me.permissions.length === 0 && <p role="alert" data-testid="admin-no-role">Your account has no Convo administrator role.</p>}
      {me && tab === 'accounts' && can('ACCOUNTS_READ') && <Accounts api={api} onError={fail} can={can} />}
      {me && tab === 'audit' && can('AUDIT_READ') && <Audit api={api} onError={fail} can={can} />}
      {me && tab === 'health' && can('HEALTH_READ') && <HealthPanel api={api} onError={fail} can={can} />}
    </main>
  );
}

function Accounts({ api, onError, can }: { api: AdminApi; onError: (e: unknown) => void; can: (p: Permission) => boolean }) {
  const [q, setQ] = useState('');
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const search = useCallback(() => void api.accounts(q).then(setAccounts).catch(onError), [api, q, onError]);
  useEffect(() => { const timer = setTimeout(search, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (open) void api.devices(open).then(setDevices).catch(onError); }, [api, open, onError]);
  const reason = (what: string) => { const r = window.prompt(`Reason for ${what} (recorded in the audit log):`); return r && r.trim() ? r.trim() : null; };
  return (
    <section>
      <input className="admin-search" type="search" placeholder="Search by handle or name" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-search" />
      <table className="admin-table">
        <thead><tr><th>Handle</th><th>Name</th><th>Status</th><th>Devices</th><th /></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.accountId} data-testid={`admin-account-${a.username}`}>
              <td>@{a.username}</td><td>{a.displayName ?? '—'}</td>
              <td><span className={`status ${a.status}`} data-testid="admin-status">{a.status}</span></td>
              <td>{can('DEVICES_READ') ? <button className="btn btn-ghost" onClick={() => setOpen(open === a.accountId ? null : a.accountId)} data-testid="admin-devices">{a.activeDevices}</button> : a.activeDevices}</td>
              <td>
                {can('ACCOUNT_STATUS') && <button className="btn" data-testid="admin-toggle-status" onClick={() => {
                  const r = reason(a.status === 'active' ? 'disabling this account' : 're-enabling this account'); if (!r) return;
                  void api.setDisabled(a.accountId, a.status === 'active', r).then(search).catch(onError);
                }}>{a.status === 'active' ? 'Disable' : 'Enable'}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="admin-devices" data-testid="admin-device-list">
          <h2>Devices</h2>
          {devices.length === 0 ? <p className="muted-text">No active devices.</p> : devices.map((d) => (
            <div className="settings-row" key={d.deviceId}>
              <span className="settings-row-text">#{d.deviceId} · {d.platform} · enrolled {new Date(d.createdAt).toLocaleString()}{d.lastSeenDay ? ` · last seen ${d.lastSeenDay}` : ''}</span>
              {can('DEVICE_REVOKE') && <button className="btn" data-testid="admin-revoke" onClick={() => { const r = reason('revoking this device'); if (r) void api.revoke(open, d.deviceId, r).then(() => api.devices(open).then(setDevices)).then(search).catch(onError); }}>Revoke</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Audit({ api, onError, can }: { api: AdminApi; onError: (e: unknown) => void; can: (p: Permission) => boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  useEffect(() => { void api.audit().then(setEntries).catch(onError); }, [api, onError]);
  return (
    <section>
      <p className="muted-text">Every administrative change with its reason. Each entry's hash covers the previous one; store the chain head elsewhere to detect database rewrites.</p>
      <button className="btn btn-primary" onClick={() => void api.verify().then(setVerification).catch(onError)} data-testid="admin-verify">Verify chain</button>
      {can('AUDIT_CHECKPOINT') && <button className="btn" onClick={() => void api.checkpoint().then(setVerification).catch(onError)} data-testid="admin-checkpoint">Write checkpoint now</button>}
      {can('AUDIT_EXPORT') && <button className="btn" data-testid="admin-export" onClick={() => {
        const r = window.prompt('Reason for exporting the audit log (recorded in the audit log):');
        if (!r?.trim()) return;
        void api.exportAudit(r.trim()).then((data) => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const link = Object.assign(document.createElement('a'), { href: url, download: `convo-audit-${new Date().toISOString().slice(0, 10)}.json` });
          link.click(); URL.revokeObjectURL(url);
          return api.audit().then(setEntries);
        }).catch(onError);
      }}>Export (audited)</button>}
      {verification && <p role="status" data-testid="admin-verification" className={verification.valid ? '' : 'failed'}>
        {verification.valid ? `Chain intact: ${verification.entries} entries, head ${verification.head.slice(0, 16)}…, ${verification.checkpointsChecked} independent checkpoint(s) match`
          : verification.checkpointMismatchSeq ? `Database disagrees with the independent checkpoint at entry ${verification.checkpointMismatchSeq}` : `Chain broken at entry ${verification.firstBrokenSeq}`}</p>}
      <table className="admin-table">
        <thead><tr><th>#</th><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
        <tbody>{entries.map((e) => <tr key={e.seq} data-testid="admin-audit-entry"><td>{e.seq}</td><td>{new Date(e.at).toLocaleString()}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.target}</td><td>{e.reason}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

/** Seconds from an ISO-8601 duration such as `PT1M30.5S` (the server's `Duration`). */
function seconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/**
 * Aggregate service health (ADM-01): counts only, never accounts, devices or endpoints. Dead
 * letters are wake-ups the distributor did not accept; they can be re-queued after an outage.
 */
function HealthPanel({ api, onError, can }: { api: AdminApi; onError: (e: unknown) => void; can: (p: Permission) => boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => void api.health().then(setHealth).catch(onError), [api, onError]);
  useEffect(load, [load]);
  const labels: Record<string, string> = { gave_up: 'Gave up after retries', expired: 'Expired before delivery', rejected: 'Rejected by distributor' };
  const dead = Object.entries(health?.push.deadLetters ?? {});
  const messageDead = dead.filter(([k]) => k.endsWith('/message')).reduce((n, [, v]) => n + v, 0);
  return (
    <section data-testid="admin-health">
      <h2>Push wake-ups</h2>
      <p className="muted-text">Content-free wake-ups for devices that are not connected. A missed wake-up loses no messages: they wait in the device's mailbox until it connects.</p>
      <button className="btn" onClick={load} data-testid="admin-health-refresh">Refresh</button>
      {health && (
        <table className="admin-table">
          <tbody>
            <tr><th scope="row">Waiting for delivery or retry</th><td data-testid="admin-push-pending">{health.push.pending}</td></tr>
            <tr><th scope="row">Oldest waiting</th><td>{health.push.pending ? `${Math.round(seconds(health.push.oldestPending))} s` : '—'}</td></tr>
            {dead.length === 0 && <tr><th scope="row">Failed in the last 24 hours</th><td data-testid="admin-push-dead">0</td></tr>}
            {dead.map(([key, n]) => {
              const [reason = '', kind = ''] = key.split('/');
              return <tr key={key} data-testid="admin-push-dead-row"><th scope="row">{labels[reason] ?? reason} ({kind === 'call' ? 'call rings' : 'messages'})</th><td>{n}</td></tr>;
            })}
          </tbody>
        </table>
      )}
      {can('PUSH_REDRIVE') && messageDead > 0 && (
        <button className="btn btn-primary" data-testid="admin-push-redrive" onClick={() => {
          const r = window.prompt('Reason for re-sending failed wake-ups (recorded in the audit log):');
          if (r && r.trim()) void api.redrive(r.trim()).then((out) => { setNotice(`${out.queued} wake-ups queued again.`); load(); }).catch(onError);
        }}>Retry failed message wake-ups</button>
      )}
      {notice && <p role="status" data-testid="admin-push-notice">{notice}</p>}
    </section>
  );
}
