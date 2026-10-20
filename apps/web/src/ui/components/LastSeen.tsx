import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { useI18n } from '../i18n/i18n';

/** Fetch only the displayed contact. Hidden privacy or a failed lookup clears stale values. */
export function LastSeen({ client, accountId }: { client: EnclaveClient; accountId: string }) {
  const { t, locale } = useI18n(); const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false; setAt(null);
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void client.lastSeen(accountId).then((p) => !stopped && setAt(p.at)).catch(() => !stopped && setAt(null));
    };
    load(); const timer = setInterval(load, 10000);
    document.addEventListener('visibilitychange', load);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [client, accountId]);
  if (!at) return null;
  const seen = new Date(at); if (!Number.isFinite(seen.getTime())) return null;
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(seen);
  const date = `${String(seen.getDate()).padStart(2, '0')}.${String(seen.getMonth() + 1).padStart(2, '0')}.${seen.getFullYear()}`;
  return <span className="last-seen" data-testid="last-seen">{seen.toDateString() === new Date().toDateString() ? t('presence.today', { time }) : t('presence.date', { date, time })}</span>;
}
