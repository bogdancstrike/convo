import { useEffect, useMemo, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { REPORT_MAX_ITEMS } from '../../crypto/content';
import { Dialog } from '../components/Dialog';
import { useI18n } from '../i18n/i18n';

/**
 * Abuse report (specs AC-SEC-09). The reporter explicitly picks which messages to include (none
 * are pre-selected), sees exactly who will receive them in readable form, and sends them end-to-end
 * encrypted to one organization security contact. Cancelling sends nothing; nothing is uploaded or
 * kept on the server. Retrying the same report never duplicates it.
 */
export function ReportDialog({ client, conversation, messages, onClose }: { client: EnclaveClient; conversation: Conversation; messages: ChatMessage[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [recipients, setRecipients] = useState<{ accountId: string; displayName: string }[] | null>(null);
  const [recipient, setRecipient] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'edit' | 'sending' | 'sent' | 'failed'>('edit');
  const [names, setNames] = useState<Record<string, string>>({});
  // One report ID per dialog: a retry after a failure re-sends the same report.
  const reportId = useMemo(() => crypto.randomUUID().replace(/-/g, ''), []);
  const candidates = useMemo(() => messages.filter((m) => !m.notice && !m.deleted && !m.undecryptable && (m.body || m.attachments?.length || m.viewOnce)).slice(-100), [messages]);
  useEffect(() => { void client.reportRecipients().then((r) => { setRecipients(r); if (r.length === 1) setRecipient(r[0]!.accountId); }).catch(() => setRecipients([])); }, [client]);
  useEffect(() => {
    void Promise.all([...new Set(candidates.map((m) => m.authorId))].map(async (id) => [id, id === client.accountId ? t('poll.you') : await client.displayName(id)] as const))
      .then((pairs) => setNames(Object.fromEntries(pairs)));
  }, [candidates]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (m: ChatMessage) => `${m.authorId}/${m.id}`;
  const chosen = candidates.filter((m) => selected.has(key(m)));
  const reported = conversation.kind === 'direct' ? conversation.id : undefined;
  const recipientName = recipients?.find((r) => r.accountId === recipient)?.displayName ?? '';
  const send = async () => {
    setState('sending');
    try { await client.sendReport(recipient, { reportId, reason, conversationId: conversation.id, messages: chosen, reportedAccountId: reported }); setState('sent'); }
    catch { setState('failed'); }
  };
  return (
    <Dialog labelledBy="report-title" onClose={onClose} className="report-dialog">
      <div data-testid="report-dialog">
        <h2 id="report-title">{t('report.title')}</h2>
        {state === 'sent' ? <p data-testid="report-sent">{t('report.sent', { name: recipientName })}</p> : recipients && recipients.length === 0 ? (
          <p role="status" data-testid="report-no-recipients">{t('report.noRecipients')}</p>
        ) : (
          <>
            <label className="field"><span>{t('report.to')}</span>
              <select value={recipient} onChange={(e) => setRecipient(e.target.value)} data-testid="report-recipient">
                <option value="">{t('report.chooseRecipient')}</option>
                {(recipients ?? []).map((r) => <option key={r.accountId} value={r.accountId}>{r.displayName}</option>)}
              </select>
            </label>
            <fieldset className="report-messages"><legend>{t('report.select', { max: REPORT_MAX_ITEMS })}</legend>
              {candidates.map((m) => (
                <label key={key(m)} className="report-item">
                  <input type="checkbox" checked={selected.has(key(m))} disabled={!selected.has(key(m)) && selected.size >= REPORT_MAX_ITEMS}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(key(m))) n.delete(key(m)); else n.add(key(m)); return n; })} data-testid="report-message" />
                  <span><strong>{names[m.authorId] ?? '…'}</strong> · {new Date(m.sentAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<br />
                    {m.body || (m.attachments?.length ? `📎 ${m.attachments.map((a) => a.fileName ?? a.contentType).join(', ')}` : t('viewOnce.photo'))}</span>
                </label>
              ))}
            </fieldset>
            <label className="field"><span>{t('report.reason')}</span><textarea value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} data-testid="report-reason" /></label>
            <p className="report-disclosure" data-testid="report-disclosure">{recipient
              ? t('report.disclosure', { count: chosen.length, name: recipientName })
              : t('report.disclosureNone')}</p>
            {state === 'failed' && <p role="alert" className="failed">{t('report.failed')}</p>}
          </>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{state === 'sent' ? t('invite.done') : t('thread.cancel')}</button>
          {state !== 'sent' && !!recipients?.length && (
            <button className="btn btn-primary danger" disabled={!recipient || !chosen.length || state === 'sending'} onClick={() => void send()} data-testid="report-send">
              {state === 'failed' ? t('report.retry') : t('report.send', { count: chosen.length })}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** A received report, shown to the security contact. */
export function ReportCard({ message }: { message: ChatMessage }) {
  const { t, locale } = useI18n();
  const r = message.report!;
  return (
    <div className="report-card" data-testid="report-card">
      <div className="report-head">⚠️ {t('report.cardTitle')}</div>
      <div className="muted-text">{t('report.cardChat', { chat: r.chat.title })}{r.reported ? ` · ${t('report.cardAbout', { name: r.reported.name })}` : ''}</div>
      {r.reason && <p className="report-reason">“{r.reason}”</p>}
      <ol className="report-evidence">
        {r.items.map((i, n) => (
          <li key={n}><strong>{i.authorName}</strong> · {new Date(i.sentAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {i.text && <div className="report-text">{i.text}</div>}
            {i.files?.length ? <div className="muted-text">📎 {i.files.join(', ')}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
