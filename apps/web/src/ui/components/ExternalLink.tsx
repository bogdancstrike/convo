import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EnclaveClient } from '../../core/client';
import { normalizeLink } from '../../lib/links';
import { useI18n } from '../i18n/i18n';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
const ConfirmLinks = createContext<((url: string) => void) | null>(null);
export function LinkPreferences({ client, children }: { client: EnclaveClient; children: ReactNode }) {
  const [confirm, setConfirm] = useState(client.settings.confirmExternalLinks);
  const [destination, setDestination] = useState<string | null>(null);
  const { t } = useI18n(); const titleId = useId();
  useEffect(() => client.on('settings', (s) => setConfirm(s.confirmExternalLinks)), [client]);
  return <ConfirmLinks.Provider value={confirm ? setDestination : null}>{children}
    {destination && createPortal(<Dialog className="external-link-dialog" labelledBy={titleId} onClose={() => setDestination(null)}>
      <div className="external-link-heading"><span className="external-link-symbol"><Icon name="link" size={26} /></span>
        <div><h2 id={titleId}>{t('links.title')}</h2><p>{t('links.description')}</p></div></div>
      <div className="external-link-destination"><span className="muted-text">{t('links.destination')}</span>
        <strong>{new URL(destination).hostname}</strong><span className="external-link-url" dir="ltr">{destination}</span></div>
      <p className="external-link-help"><Icon name="shield" size={18} /><span>{t('links.help')}</span></p>
      <div className="external-link-actions"><button className="btn" autoFocus onClick={() => setDestination(null)}>{t('thread.cancel')}</button>
        <a className="btn btn-primary" href={destination} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => setDestination(null)}>{t('links.open')}<Icon name="next" size={18} /></a></div>
      <p className="external-link-preference">{t('links.preference')}</p>
    </Dialog>, document.body)}
  </ConfirmLinks.Provider>;
}
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const requestConfirmation = useContext(ConfirmLinks); const target = normalizeLink(href);
  if (!target) return <>{children}</>;
  return <a href={target} className={className} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={(e) => {
    e.stopPropagation();
    if (requestConfirmation) { e.preventDefault(); requestConfirmation(target); }
  }}>{children}</a>;
}
