import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { tally } from '../../core/polls';
import { POLL_MAX_OPTION_TEXT, POLL_MAX_OPTIONS, POLL_MAX_QUESTION } from '../../crypto/content';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * WhatsApp-style poll creation: a question, 1–10 options (a new empty field appears as you type)
 * and "allow multiple answers". Ballots are visible to chat members; the dialog says so.
 */
export function PollComposer({ client, conversationId, onClose }: { client: EnclaveClient; conversationId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const setOption = (index: number, value: string) => {
    const next = options.map((o, i) => (i === index ? value : o));
    // Keep exactly one trailing empty field (up to the limit), like WhatsApp.
    while (next.length > 2 && !next[next.length - 1]!.trim() && !next[next.length - 2]!.trim()) next.pop();
    if (next[next.length - 1]!.trim() && next.length < POLL_MAX_OPTIONS) next.push('');
    setOptions(next);
  };
  const send = async () => {
    setBusy(true); setError(null);
    try { await client.sendPoll(conversationId, question, filled, multiple); onClose(); }
    catch { setError(t('poll.failed')); } finally { setBusy(false); }
  };
  return (
    <Dialog labelledBy="poll-title" onClose={onClose} className="poll-dialog">
      <div data-testid="poll-composer">
        <h2 id="poll-title">{t('poll.create')}</h2>
        <label className="field"><span>{t('poll.question')}</span>
          <input value={question} maxLength={POLL_MAX_QUESTION} onChange={(e) => setQuestion(e.target.value)} placeholder={t('poll.questionPlaceholder')} data-testid="poll-question" autoFocus />
        </label>
        <fieldset className="poll-options-edit"><legend>{t('poll.options')}</legend>
          {options.map((o, i) => (
            <input key={i} value={o} maxLength={POLL_MAX_OPTION_TEXT} onChange={(e) => setOption(i, e.target.value)} placeholder={t('poll.addOption')}
              aria-label={t('poll.optionN', { n: i + 1 })} data-testid={`poll-option-${i}`} />
          ))}
        </fieldset>
        <label className="toggle-row"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} data-testid="poll-multiple" /> {t('poll.multiple')}</label>
        <p className="muted-text">{t('poll.visible')}</p>
        {error && <p role="alert" className="failed">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !question.trim() || filled.length < 1} onClick={() => void send()} data-testid="poll-send">{t('poll.send')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * A poll inside its message bubble: options with checkboxes (multiple) or radios (single), live
 * counts and bars, "View votes" with voter names, and "Close poll" for the author or an admin.
 */
export function PollCard({ client, message }: { client: EnclaveClient; message: ChatMessage }) {
  const { t } = useI18n();
  const poll = message.poll!;
  const { counts, voters } = tally(poll);
  const mine = poll.votes[client.accountId]?.optionIds ?? [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [showVotes, setShowVotes] = useState(false);
  const [canClose, setCanClose] = useState(false);
  useEffect(() => { void client.canClosePoll(message, client.accountId).then(setCanClose); }, [client, message]);
  useEffect(() => {
    if (!showVotes) return;
    const ids = [...new Set(Object.values(counts).flat())];
    void Promise.all(ids.map(async (id) => [id, id === client.accountId ? t('poll.you') : await client.displayName(id)] as const)).then((pairs) => setNames(Object.fromEntries(pairs)));
  }, [showVotes, voters]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (optionId: string) => {
    if (poll.closed) return;
    const next = poll.multiple ? (mine.includes(optionId) ? mine.filter((o) => o !== optionId) : [...mine, optionId]) : (mine.includes(optionId) ? [] : [optionId]);
    void client.votePoll(message, next).catch(() => undefined);
  };
  const top = Math.max(1, ...Object.values(counts).map((v) => v.length));
  return (
    <div className={`poll-card${poll.closed ? ' closed' : ''}`} data-testid="poll-card" data-voters={voters} data-closed={poll.closed ? 'true' : 'false'}>
      <div className="poll-question"><Icon name="poll" size={16} /> {poll.question}</div>
      <div className="poll-mode muted-text">{poll.closed ? t('poll.closed') : poll.multiple ? t('poll.selectMany') : t('poll.selectOne')}</div>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const count = counts[o.id]?.length ?? 0;
          const chosen = mine.includes(o.id);
          return (
            <li key={o.id}>
              <button className={`poll-option${chosen ? ' chosen' : ''}`} onClick={() => toggle(o.id)} disabled={!!poll.closed} role={poll.multiple ? 'checkbox' : 'radio'} aria-checked={chosen} data-testid="poll-option">
                <span className={`poll-check${poll.multiple ? '' : ' round'}`} aria-hidden="true">{chosen && <Icon name="check" size={14} />}</span>
                <span className="poll-option-text">{o.text}</span>
                <span className="poll-count" data-testid="poll-count">{count}</span>
                <span className="poll-bar" style={{ width: `${(count / top) * 100}%` }} aria-hidden="true" />
              </button>
              {showVotes && count > 0 && <div className="poll-voters muted-text">{counts[o.id]!.map((id) => names[id] ?? '…').join(', ')}</div>}
            </li>
          );
        })}
      </ul>
      <div className="poll-actions">
        <button className="btn btn-ghost" onClick={() => setShowVotes((v) => !v)} data-testid="poll-view-votes">{showVotes ? t('poll.hideVotes') : t('poll.viewVotes', { count: voters })}</button>
        {canClose && !poll.closed && <button className="btn btn-ghost" onClick={() => void client.closePoll(message)} data-testid="poll-close">{t('poll.close')}</button>}
      </div>
    </div>
  );
}
