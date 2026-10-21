import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../core/client';
import { useI18n } from './i18n/i18n';
import { Dialog } from './components/Dialog';

/**
 * Handles `#/join/<token>` invite links: asks before filing a join request, then confirms that
 * admins were asked. The link reveals nothing about the group until an admin adds this account.
 */
export function JoinLinkHandler({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'ask' | 'sent' | 'invalid'>('ask');
  useEffect(() => {
    const read = () => {
      const match = /^#\/join\/([A-Za-z0-9_-]{32})$/.exec(window.location.hash);
      if (!match) return;
      setToken(match[1]!); setState('ask');
      window.history.replaceState(null, '', '#/');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  if (!token) return null;
  const close = () => setToken(null);
  return (
    <Dialog labelledBy="join-title" onClose={close}>
      <div data-testid="join-dialog">
        <h2 id="join-title">{t('invite.joinTitle')}</h2>
        <p>{state === 'ask' ? t('invite.joinBody') : state === 'sent' ? t('invite.joinSent') : t('invite.joinInvalid')}</p>
        <div className="dialog-actions">
          {state === 'ask' ? (
            <>
              <button className="btn" onClick={close}>{t('thread.cancel')}</button>
              <button className="btn btn-primary" data-testid="join-request-send"
                onClick={() => void client.requestToJoin(token).then(() => setState('sent'), () => setState('invalid'))}>{t('invite.joinAsk')}</button>
            </>
          ) : <button className="btn btn-primary" onClick={close} data-testid="join-close">{t('invite.done')}</button>}
        </div>
      </div>
    </Dialog>
  );
}
