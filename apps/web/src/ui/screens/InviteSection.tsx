import { useCallback, useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Invite link and join requests for owners/admins (GRP-03). A link is shown once after creation
 * (the server keeps only its hash); "Reset links" revokes every link. Approving a request adds the
 * person with a normal MLS commit; declining removes the request.
 */
export function InviteSection({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const [link, setLink] = useState<string | null>(null);
  const [requests, setRequests] = useState<{ accountId: string; label: string }[]>([]);
  const [banned, setBanned] = useState<{ accountId: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => void client.joinRequests(conversation.id)
    .then((list) => Promise.all(list.map(async (r) => ({ accountId: r.accountId, label: await client.displayName(r.accountId) }))))
    .then(setRequests).catch(() => undefined)
    .then(() => client.groupBans(conversation.id)).then((ids) => Promise.all((ids ?? []).map(async (accountId) => ({ accountId, label: await client.displayName(accountId) }))))
    .then(setBanned).catch(() => undefined), [client, conversation.id]);
  useEffect(() => { load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, [load]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await task(); } catch { setError(t('invite.failed')); } finally { setBusy(false); load(); }
  };
  return (
    <section className="drawer-section" aria-labelledby="invite-title" data-testid="invite-section">
      <h4 id="invite-title">{t('invite.title')}</h4>
      {link ? (
        <div className="invite-link">
          <input readOnly value={link} aria-label={t('invite.title')} data-testid="invite-link" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(link)}>{t('thread.copy')}</button>
        </div>
      ) : (
        <button className="row action" disabled={busy} onClick={() => void run(async () => setLink((await client.createInviteLink(conversation.id)).url))} data-testid="create-invite">
          <span className="action-icon"><Icon name="link" /></span><span className="row-main"><span className="row-title">{t('invite.create')}</span></span>
        </button>
      )}
      <p className="muted-text">{t('invite.help')}</p>
      <button className="btn btn-ghost" disabled={busy} onClick={() => void run(async () => { await client.revokeInviteLinks(conversation.id); setLink(null); })} data-testid="revoke-invites">{t('invite.revoke')}</button>
      {requests.length > 0 && <h4>{t('invite.requests', { count: requests.length })}</h4>}
      {requests.map((r) => (
        <div className="settings-row" key={r.accountId} data-testid="join-request">
          <span className="settings-row-text">{r.label}</span>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => client.addGroupMembers(conversation.id, [r.accountId]))} data-testid="approve-join">{t('invite.approve')}</button>
          <button className="btn" disabled={busy} onClick={() => void run(() => client.declineJoinRequest(conversation.id, r.accountId))} data-testid="decline-join">{t('invite.decline')}</button>
        </div>
      ))}
      {banned.length > 0 && <h4>{t('group.banned', { count: banned.length })}</h4>}
      {banned.map((b) => (
        <div className="settings-row" key={b.accountId} data-testid="banned-member">
          <span className="settings-row-text">{b.label}</span>
          <button className="btn" disabled={busy} onClick={() => void run(() => client.unbanMember(conversation.id, b.accountId))} data-testid="unban">{t('group.unban')}</button>
        </div>
      ))}
      {error && <p role="alert" className="failed">{error}</p>}
    </section>
  );
}
