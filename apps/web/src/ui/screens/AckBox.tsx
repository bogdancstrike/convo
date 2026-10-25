import { useEffect, useState } from 'react';
import { ackClosed, type EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Explicit announcement acknowledgement (specs §30.6). Members acknowledge deliberately and see
 * who receives their response; named reviewers see counts derived on their own device. A
 * pending/late entry means "no response received", not proof that someone did not read it.
 */
export function AckBox({ client, message }: { client: EnclaveClient; message: ChatMessage }) {
  const { t } = useI18n();
  const request = message.ackRequest;
  const [names, setNames] = useState<Record<string, string>>({});
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!request) return;
    const ids = [...new Set([...request.reviewers, ...(request.reviewers.includes(client.accountId) ? request.audience : [])])];
    void Promise.all(ids.map(async (id) => [id, id === client.accountId ? t('ack.you') : await client.displayName(id)] as const))
      .then((entries) => setNames(Object.fromEntries(entries)));
  }, [client, request, t]);
  if (!request || message.deleted) return null;
  const revision = message.revision ?? 0;
  const reviewer = request.reviewers.includes(client.accountId);
  const member = request.audience.includes(client.accountId);
  const responded = request.audience.filter((id) => message.acks?.[id]?.revision === revision);
  const now = Date.now();
  const closed = ackClosed(request, now);
  const overdue = request.due !== undefined && now > request.due;
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="ack-box" data-testid="ack-box" data-closed={closed || undefined}>
      <p className="ack-title"><Icon name="check" size={14} /> {t('ack.requested')}</p>
      {closed ? <p className="muted-text" data-testid="ack-closed">{t('ack.closed')}</p> : (
        <>
          {request.due !== undefined && <p className={overdue ? 'ack-late' : 'muted-text'} data-testid="ack-due-at">{t(overdue ? 'ack.overdue' : 'ack.dueAt', { when: when(request.due) })}</p>}
          {request.expires !== undefined && <p className="muted-text" data-testid="ack-closes-at">{t('ack.closesAt', { when: when(request.expires) })}</p>}
        </>
      )}
      {member && (() => {
        const mine = message.myAck;
        const current = mine?.revision === revision;
        return (
          <>
            {!current && mine && <p className="ack-note" data-testid="ack-updated">{t('ack.updated')}</p>}
            {current ? (
              <p className="ack-state" data-testid="ack-state" data-state={mine!.pending.length ? 'pending' : 'sent'}>
                {mine!.pending.length ? t('ack.pending') : t('ack.sent')}
                {!closed && <button className="btn btn-ghost ack-withdraw" disabled={busy} data-testid="ack-withdraw"
                  onClick={() => { if (!window.confirm(t('ack.withdrawConfirm'))) return; setBusy(true); void client.withdrawAcknowledgement(message).finally(() => setBusy(false)); }}>{t('ack.withdraw')}</button>}
              </p>
            ) : closed ? null : (
              <button className="btn btn-primary" disabled={busy} data-testid="ack-button"
                onClick={() => { setBusy(true); void client.acknowledge(message).finally(() => setBusy(false)); }}>{t('ack.action')}</button>
            )}
            <p className="muted-text" data-testid="ack-reviewers">{t('ack.goesTo', { names: request.reviewers.map((id) => names[id] ?? '…').join(', ') })}</p>
          </>
        );
      })()}
      {reviewer && (
        <>
          <button className="btn btn-ghost" onClick={() => setShowList((s) => !s)} aria-expanded={showList} data-testid="ack-count">
            {t('ack.count', { done: responded.length, total: request.audience.length })}
          </button>
          {showList && (
            <ul className="ack-list" data-testid="ack-list">
              {request.audience.map((id) => (
                <li key={id} data-state={responded.includes(id) ? (message.acks?.[id]?.late ? 'late' : 'acknowledged') : 'pending'}>
                  <span>{names[id] ?? '…'}</span>
                  <span className={!responded.includes(id) && overdue ? 'ack-late' : 'muted-text'}>
                    {responded.includes(id) ? t(message.acks?.[id]?.late ? 'ack.late' : 'ack.acknowledged')
                      : message.acks?.[id] ? t('ack.outdated') : t(overdue ? 'ack.lateNoResponse' : 'ack.noResponse')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!member && !reviewer && <p className="muted-text">{t('ack.notRequired')}</p>}
    </div>
  );
}

/**
 * Composer option: who reviews the responses. The publisher always does; by default the community
 * owners join, or the publisher picks owners/admins (at most 9 more, 10 reviewers in total).
 */
export function AckReviewerPicker({ client, conversationId, value, onChange }: { client: EnclaveClient; conversationId: string; value: string[] | null; onChange: (ids: string[] | null) => void }) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void client.ackReviewerCandidates(conversationId).then((ids) => Promise.all(ids.filter((id) => id !== client.accountId)
      .map(async (id) => ({ id, name: await client.displayName(id) })))).then(setCandidates);
  }, [client, conversationId]);
  if (!candidates.length) return null;
  const chosen = value ?? [];
  return (
    <fieldset className="ack-reviewers" data-testid="ack-reviewer-picker">
      <legend>{t('ack.reviewersLabel')}</legend>
      <label><input type="radio" checked={value === null} onChange={() => onChange(null)} data-testid="ack-reviewers-default" /> {t('ack.reviewersDefault')}</label>
      <label><input type="radio" checked={value !== null} onChange={() => onChange([])} data-testid="ack-reviewers-custom" /> {t('ack.reviewersCustom')}</label>
      {value !== null && candidates.map((c) => (
        <label key={c.id} className="ack-reviewer"><input type="checkbox" checked={chosen.includes(c.id)} disabled={!chosen.includes(c.id) && chosen.length >= 9}
          onChange={(e) => onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))} data-testid={`ack-reviewer-${c.name}`} /> {c.name}</label>
      ))}
    </fieldset>
  );
}
