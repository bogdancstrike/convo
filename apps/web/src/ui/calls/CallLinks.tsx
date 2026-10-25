import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { useCalls } from './CallProvider';

/** Link URL for a call-link token (hash route, like invite links). */
/**
 * Shareable call link. A real path (not the `#/call/` route) so Android App Links can open Convo
 * directly; {@link normalizeCallLinkPath} turns it into the app route on load.
 */
export const callLinkUrl = (token: string) => `${window.location.origin}/call/${token}`;

/** Rewrites `/call/<token>` to the `#/call/<token>` route (older `#/call/` links work unchanged). */
export function normalizeCallLinkPath(location: Location = window.location, history: History = window.history): void {
  const token = /^\/call\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname)?.[1];
  if (token) history.replaceState(null, '', `/#/call/${token}`);
}

/**
 * Group info: any member can create a call link (AC-CALL-07). It only works for current members
 * of this group — the server checks membership on every use — and the creator can revoke it.
 * The token is shown once; the server stores only its hash.
 */
export function CallLinkSection({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t, locale } = useI18n();
  const [link, setLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await task(); } catch { setNotice(t('invite.failed')); } finally { setBusy(false); }
  };
  return (
    <section className="drawer-section" aria-labelledby="call-link-title" data-testid="call-link-section">
      <h4 id="call-link-title">{t('calls.link')}</h4>
      {link ? (
        <>
          <div className="invite-link">
            <input readOnly value={callLinkUrl(link.token)} aria-label={t('calls.link')} data-testid="call-link" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(callLinkUrl(link.token)).then(() => setNotice(t('calls.linkCopied')))}>{t('calls.linkCopy')}</button>
          </div>
          <p className="muted-text">{t('calls.linkHint', { date: new Date(link.expiresAt).toLocaleString(locale) })}</p>
          <button className="btn btn-ghost" disabled={busy} data-testid="call-link-revoke"
            onClick={() => void run(async () => { await client.revokeCallLink(link.token); setLink(null); setNotice(t('calls.linkRevoked')); })}>{t('calls.linkRevoke')}</button>
        </>
      ) : (
        <button className="row action" disabled={busy} data-testid="call-link-create" onClick={() => void run(async () => setLink(await client.createCallLink(conversation.id)))}>
          <span className="action-icon"><Icon name="calls" /></span><span className="row-main"><span className="row-title">{t('calls.linkCreate')}</span></span>
        </button>
      )}
      {notice && <p className="muted-text" role="status">{notice}</p>}
    </section>
  );
}

/** Handles `#/call/<token>`: joins the group's running call (or rings the group) for members. */
export function CallLinkHandler() {
  const { joinLink } = useCalls();
  useEffect(() => {
    const read = () => {
      const match = /^#\/call\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
      if (!match) return;
      window.history.replaceState(null, '', '#/');
      joinLink(match[1]!);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [joinLink]);
  return null;
}
