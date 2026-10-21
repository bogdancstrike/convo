import { useCallback, useEffect, useState } from 'react';
import { AdminApi, AdminError, type AccountSummary, type AuditEntry, type AuditVerification, type DeviceSummary } from './adminApi';

/**
 * Organization admin console (ADM-01, first slice): find accounts, disable/enable them, revoke
 * devices — each with a mandatory reason — and inspect/verify the hash-chained audit log.
 * English-only operator tool; production deployments serve it from a separate origin.
 */
export function AdminApp() {
  const [api, setApi] = useState<AdminApi | null>(null);
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'accounts' | 'audit'>('accounts');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void AdminApi.create().then(async (a) => { setApi(a); setAdmin(await a.session()); }).catch(() => setError('The server is unreachable.')); }, []);
  const fail = useCallback((e: unknown) => setError(e instanceof AdminError && e.status === 403 ? 'Your account does not have the Convo administrator role.'
    : e instanceof AdminError && e.status === 401 ? 'Your session expired. Sign in again.' : 'The request failed.'), []);
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
          <button className="chip" aria-pressed={tab === 'accounts'} onClick={() => setTab('accounts')} data-testid="admin-tab-accounts">Accounts</button>
          <button className="chip" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')} data-testid="admin-tab-audit">Audit log</button>
        </nav>
        <span className="muted-text" data-testid="admin-name">{admin}</span>
        <button className="btn" onClick={() => void api.signOut().then(() => setAdmin(null))}>Sign out</button>
      </header>
      {error && <p role="alert" className="failed" data-testid="admin-error">{error}</p>}
      {tab === 'accounts' ? <Accounts api={api} onError={fail} /> : <Audit api={api} onError={fail} />}
    </main>
  );
}

function Accounts({ api, onError }: { api: AdminApi; onError: (e: unknown) => void }) {
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
              <td><button className="btn btn-ghost" onClick={() => setOpen(open === a.accountId ? null : a.accountId)} data-testid="admin-devices">{a.activeDevices}</button></td>
              <td>
                <button className="btn" data-testid="admin-toggle-status" onClick={() => {
                  const r = reason(a.status === 'active' ? 'disabling this account' : 're-enabling this account'); if (!r) return;
                  void api.setDisabled(a.accountId, a.status === 'active', r).then(search).catch(onError);
                }}>{a.status === 'active' ? 'Disable' : 'Enable'}</button>
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
              <button className="btn" data-testid="admin-revoke" onClick={() => { const r = reason('revoking this device'); if (r) void api.revoke(open, d.deviceId, r).then(() => api.devices(open).then(setDevices)).then(search).catch(onError); }}>Revoke</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Audit({ api, onError }: { api: AdminApi; onError: (e: unknown) => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  useEffect(() => { void api.audit().then(setEntries).catch(onError); }, [api, onError]);
  return (
    <section>
      <p className="muted-text">Every administrative change with its reason. Each entry's hash covers the previous one; store the chain head elsewhere to detect database rewrites.</p>
      <button className="btn btn-primary" onClick={() => void api.verify().then(setVerification).catch(onError)} data-testid="admin-verify">Verify chain</button>
      <button className="btn" onClick={() => void api.checkpoint().then(setVerification).catch(onError)} data-testid="admin-checkpoint">Write checkpoint now</button>
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
