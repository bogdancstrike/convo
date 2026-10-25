import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { responses, toIcs } from '../../core/events';
import { EVENT_MAX_DESCRIPTION, EVENT_MAX_LOCATION, EVENT_MAX_TITLE, type RsvpResponse } from '../../crypto/content';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/** `datetime-local` value in this browser's zone ↔ UTC milliseconds. */
const toLocalInput = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const fromLocalInput = (value: string) => (value ? new Date(value).getTime() : NaN);

/**
 * Create or edit an event (FR-EXT-01): title, start, optional end, location and description.
 * Times are entered in this device's zone, stored as UTC and shown to others in their own zone.
 */
export function EventComposer({ client, conversationId, editing, onClose }: { client: EnclaveClient; conversationId: string; editing?: ChatMessage; onClose: () => void }) {
  const { t } = useI18n();
  const current = editing?.event;
  const nextHour = Math.ceil(Date.now() / 3600_000) * 3600_000;
  const [title, setTitle] = useState(current?.title ?? '');
  const [start, setStart] = useState(toLocalInput(current?.start ?? nextHour));
  const [end, setEnd] = useState(current?.end ? toLocalInput(current.end) : '');
  const [location, setLocation] = useState(current?.location ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    const input = { title, start: fromLocalInput(start), end: end ? fromLocalInput(end) : undefined, location, description };
    try {
      if (editing) await client.updateEvent(editing, input); else await client.createEvent(conversationId, input);
      onClose();
    } catch { setError(t('event.invalid')); } finally { setBusy(false); }
  };
  return (
    <Dialog labelledBy="event-title" onClose={onClose} className="event-dialog">
      <div data-testid="event-composer">
        <h2 id="event-title">{t(editing ? 'event.edit' : 'event.create')}</h2>
        <label className="field"><span>{t('event.name')}</span><input value={title} maxLength={EVENT_MAX_TITLE} onChange={(e) => setTitle(e.target.value)} data-testid="event-name" autoFocus /></label>
        <div className="event-times">
          <label className="field"><span>{t('event.start')}</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} data-testid="event-start" /></label>
          <label className="field"><span>{t('event.end')}</span><input type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} data-testid="event-end" /></label>
        </div>
        <label className="field"><span>{t('event.location')}</span><input value={location} maxLength={EVENT_MAX_LOCATION} onChange={(e) => setLocation(e.target.value)} data-testid="event-location" /></label>
        <label className="field"><span>{t('event.description')}</span><textarea value={description} maxLength={EVENT_MAX_DESCRIPTION} rows={3} onChange={(e) => setDescription(e.target.value)} data-testid="event-description" /></label>
        {error && <p role="alert" className="failed">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !title.trim() || Number.isNaN(fromLocalInput(start))} onClick={() => void save()} data-testid="event-save">{t(editing ? 'event.save' : 'poll.send')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * An event inside its bubble: date tile, title, time in the viewer's zone (and the creator's when
 * different), location, Going / Maybe / Can't go with counts, attendee names, Add to calendar, and
 * Edit / Cancel event for its creator or a group admin.
 */
export function EventCard({ client, message }: { client: EnclaveClient; message: ChatMessage }) {
  const { t, locale } = useI18n();
  const event = message.event!;
  const answers = responses(event);
  const mine = event.rsvps[client.accountId]?.response;
  const closed = !!event.cancelled || Date.now() > (event.end ?? event.start);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Record<string, string> | null>(null);
  useEffect(() => { void client.canEditEvent(message, client.accountId).then(setCanEdit); }, [client, message]);
  useEffect(() => {
    if (!names) return;
    const ids = Object.keys(event.rsvps).filter((id) => !names[id]);
    if (ids.length) void Promise.all(ids.map(async (id) => [id, id === client.accountId ? t('poll.you') : await client.displayName(id)] as const)).then((pairs) => setNames((n) => ({ ...n, ...Object.fromEntries(pairs) })));
  }, [names, event.rsvps]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (zone?: string) => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) };
    const startText = new Date(event.start).toLocaleString(locale, options);
    return event.end ? `${startText} – ${new Date(event.end).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) })}` : startText;
  };
  const day = new Date(event.start);
  const download = () => {
    const url = URL.createObjectURL(new Blob([toIcs(event, `${message.authorId}.${message.id}`)], { type: 'text/calendar' }));
    const a = document.createElement('a'); a.href = url; a.download = `${event.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'event'}.ics`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const answer = (response: RsvpResponse) => void client.rsvp(message, response).catch(() => undefined);
  return (
    <div className={`event-card${event.cancelled ? ' cancelled' : ''}`} data-testid="event-card" data-cancelled={event.cancelled ? 'true' : 'false'} data-revision={event.revision}>
      <div className="event-head">
        <div className="event-date" aria-hidden="true"><span>{day.toLocaleString(locale, { month: 'short' })}</span><strong>{day.getDate()}</strong></div>
        <div className="event-main">
          <div className="event-name">{event.title}</div>
          <div className="event-when" data-testid="event-when"><Icon name="clock" size={14} /> {when()}</div>
          {event.zone !== viewerZone && <div className="muted-text event-zone">{t('event.theirTime', { time: when(event.zone), zone: event.zone })}</div>}
          {event.location && <div className="event-where"><Icon name="pin" size={14} /> {event.location}</div>}
        </div>
      </div>
      {event.description && <p className="event-description">{event.description}</p>}
      {event.cancelled ? <p className="event-status" data-testid="event-status">{t('event.cancelled')}</p> : closed && <p className="event-status">{t('event.ended')}</p>}
      <div className="event-rsvp" role="group" aria-label={t('event.rsvp')}>
        {(['going', 'maybe', 'no'] as const).map((r) => (
          <button key={r} className={`btn${mine === r ? ' btn-primary' : ''}`} disabled={closed} aria-pressed={mine === r} onClick={() => answer(r)} data-testid={`rsvp-${r}`}>
            {t(`event.${r}`)} <span className="event-count" data-testid={`rsvp-count-${r}`}>{answers[r].length}</span>
          </button>
        ))}
      </div>
      {names && (['going', 'maybe', 'no'] as const).filter((r) => answers[r].length).map((r) => (
        <p key={r} className="muted-text event-names">{t(`event.${r}`)}: {answers[r].map((id) => names[id] ?? '…').join(', ')}</p>
      ))}
      <div className="poll-actions">
        <button className="btn btn-ghost" onClick={() => setNames((n) => (n ? null : {}))} data-testid="event-responses">{names ? t('event.hideResponses') : t('event.responses')}</button>
        <button className="btn btn-ghost" onClick={download} data-testid="event-ics">{t('event.addToCalendar')}</button>
        {canEdit && !event.cancelled && <button className="btn btn-ghost" onClick={() => setEditing(true)} data-testid="event-edit">{t('event.edit')}</button>}
        {canEdit && !event.cancelled && <button className="btn btn-ghost danger" onClick={() => void client.updateEvent(message, event, true)} data-testid="event-cancel">{t('event.cancel')}</button>}
      </div>
      {editing && <EventComposer client={client} conversationId={message.conversationId} editing={message} onClose={() => setEditing(false)} />}
    </div>
  );
}
