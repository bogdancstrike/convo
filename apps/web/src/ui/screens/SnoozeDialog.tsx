import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { localZone, thisEvening, tomorrowMorning } from '../../core/snooze';
import { Dialog } from '../components/Dialog';
import { useI18n } from '../i18n/i18n';

/** Opens the snooze dialog for a conversation (from any conversation menu). */
export function openSnooze(conversationId: string): void {
  window.dispatchEvent(new CustomEvent('convo:snooze', { detail: conversationId }));
}

/**
 * Timed snooze (specs §30.8): presets resolve to an exact local time shown with the time zone
 * before confirming; the underlying mute/notify mode resumes afterwards.
 */
export function SnoozeDialog({ client }: { client: EnclaveClient }) {
  const { t, date, time } = useI18n();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [choice, setChoice] = useState('evening');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const open = (e: Event) => { setConversationId((e as CustomEvent<string>).detail); setChoice('evening'); setCustom(''); setError(false); };
    window.addEventListener('convo:snooze', open);
    return () => window.removeEventListener('convo:snooze', open);
  }, []);
  if (!conversationId) return null;
  const now = new Date();
  const options: { id: string; label: string; at: Date | null }[] = [
    { id: 'evening', label: t('snooze.evening'), at: thisEvening(now) },
    { id: 'morning', label: t('snooze.morning'), at: tomorrowMorning(now) },
    { id: '1h', label: t('snooze.hours', { count: 1 }), at: new Date(now.getTime() + 3_600_000) },
    { id: '4h', label: t('snooze.hours', { count: 4 }), at: new Date(now.getTime() + 4 * 3_600_000) },
    { id: 'custom', label: t('snooze.custom'), at: custom ? new Date(custom) : null },
  ];
  const picked = options.find((o) => o.id === choice)?.at ?? null;
  const valid = !!picked && !Number.isNaN(picked.getTime()) && picked.getTime() > Date.now();
  const zone = localZone();
  const close = () => setConversationId(null);
  return (
    <Dialog labelledBy="snooze-title" onClose={close} className="snooze-dialog">
      <h2 id="snooze-title">{t('snooze.title')}</h2>
      <p className="muted-text">{t('snooze.help')}</p>
      <fieldset className="community-visibility" data-testid="snooze-options">
        <legend className="visually-hidden">{t('snooze.title')}</legend>
        {options.map((o) => (
          <label key={o.id}>
            <input type="radio" name="snooze" checked={choice === o.id} onChange={() => setChoice(o.id)} data-testid={`snooze-${o.id}`} /> {o.label}
            {o.at && o.id !== 'custom' && <span className="muted-text"> · {date(o.at.getTime())} {time(o.at.getTime())}</span>}
          </label>
        ))}
        {choice === 'custom' && <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} data-testid="snooze-custom-at" aria-label={t('snooze.custom')} />}
      </fieldset>
      <p role="status" data-testid="snooze-summary">{valid ? t('snooze.until', { when: `${date(picked!.getTime())} ${time(picked!.getTime())}`, zone }) : t('snooze.pickFuture')}</p>
      {error && <p role="alert" className="failed">{t('snooze.failed')}</p>}
      <div className="lock-actions">
        <button className="btn btn-primary" disabled={!valid} data-testid="snooze-confirm"
          onClick={() => void client.setSnooze(conversationId, picked!.getTime(), zone).then(close).catch(() => setError(true))}>{t('snooze.confirm')}</button>
        <button className="btn btn-ghost" onClick={close}>{t('storeLock.cancel')}</button>
      </div>
    </Dialog>
  );
}
