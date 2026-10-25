import { useCallback, useEffect, useState } from 'react';
import type { EnclaveClient, ScheduledMessage } from '../../core/client';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

const toLocalInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * Pick a time for a scheduled message (specs §30.4). The message stays encrypted on this device
 * and is sent by this device once it is running at or after that time — the dialog says so.
 */
export function ScheduleDialog({ initial, onSchedule, onClose }: { initial?: number; onSchedule: (dueAt: number) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(toLocalInput(initial ?? Date.now() + 3600_000));
  const [error, setError] = useState<string | null>(null);
  const dueAt = new Date(value).getTime();
  const save = async () => {
    setError(null);
    try { await onSchedule(dueAt); onClose(); } catch { setError(t('schedule.future')); }
  };
  return (
    <Dialog labelledBy="schedule-title" onClose={onClose}>
      <div data-testid="schedule-dialog">
        <h2 id="schedule-title">{t('schedule.title')}</h2>
        <label className="field"><span>{t('schedule.when')}</span>
          <input type="datetime-local" value={value} min={toLocalInput(Date.now())} onChange={(e) => setValue(e.target.value)} data-testid="schedule-time" autoFocus />
        </label>
        <p className="muted-text">{t('schedule.deviceNote')}</p>
        {error && <p role="alert" className="failed">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={Number.isNaN(dueAt)} onClick={() => void save()} data-testid="schedule-save">{t('schedule.save')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** "N scheduled messages" bar above the composer; opens the list to edit, send now or cancel. */
export function ScheduledBar({ client, conversationId }: { client: EnclaveClient; conversationId: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const load = useCallback(() => void client.scheduledMessages(conversationId).then(setItems), [client, conversationId]);
  useEffect(() => { load(); return client.on('scheduled', (id) => { if (id === conversationId) load(); }); }, [client, conversationId, load]);
  if (!items.length) return null;
  const when = (ms: number) => new Date(ms).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <button className="scheduled-bar" onClick={() => setOpen(true)} data-testid="scheduled-bar">
        <Icon name="clock" size={16} /> {t('schedule.count', { count: items.length })} · {when(items[0]!.dueAt)}
      </button>
      {open && (
        <Dialog labelledBy="scheduled-title" onClose={() => setOpen(false)}>
          <div data-testid="scheduled-list">
            <h2 id="scheduled-title">{t('schedule.listTitle')}</h2>
            <p className="muted-text">{t('schedule.deviceNote')}</p>
            <ul className="scheduled-items">
              {items.map((item) => (
                <li key={item.id} data-testid="scheduled-item">
                  <div className="scheduled-when"><Icon name="clock" size={14} /> {when(item.dueAt)}{item.silent ? ` · ${t('schedule.quiet')}` : ''}</div>
                  <div className="scheduled-body">{item.body}</div>
                  <div className="scheduled-actions">
                    <button className="btn btn-ghost" onClick={() => setEditing(item)} data-testid="scheduled-reschedule">{t('schedule.change')}</button>
                    <button className="btn btn-ghost" onClick={() => void client.editScheduled(item.id, { dueAt: Date.now() + 1000 }).then(() => client.sendDueScheduled(Date.now() + 2000))} data-testid="scheduled-send-now">{t('schedule.sendNow')}</button>
                    <button className="btn btn-ghost danger" onClick={() => void client.cancelScheduled(item.id)} data-testid="scheduled-cancel">{t('schedule.cancel')}</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="dialog-actions"><button className="btn" onClick={() => setOpen(false)}>{t('invite.done')}</button></div>
          </div>
        </Dialog>
      )}
      {editing && <ScheduleDialog initial={editing.dueAt} onSchedule={(dueAt) => client.editScheduled(editing.id, { dueAt })} onClose={() => setEditing(null)} />}
    </>
  );
}
