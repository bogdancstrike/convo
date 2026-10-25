import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { isQuiz, quizScore, tally } from '../../core/polls';
import { POLL_MAX_OPTION_TEXT, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, QUIZ_MAX_EXPLANATION } from '../../crypto/content';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * WhatsApp-style poll creation: a question, 1–10 options (a new empty field appears as you type)
 * and "allow multiple answers". Ballots are visible to chat members; the dialog says so. Quiz mode
 * marks one correct option (radio next to each option) and adds an optional explanation.
 */
export function PollComposer({ client, conversationId, onClose }: { client: EnclaveClient; conversationId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(true);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');
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
    try {
      if (quiz) {
        // The correct index counts only non-empty options, as sent.
        const index = options.slice(0, correct ?? 0).filter((o) => o.trim()).length;
        await client.sendQuiz(conversationId, question, filled, index, explanation);
      } else await client.sendPoll(conversationId, question, filled, multiple);
      onClose();
    }
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
            <div key={i} className="poll-option-edit">
              {quiz && <input type="radio" name="quiz-correct" checked={correct === i} disabled={!o.trim()} onChange={() => setCorrect(i)}
                aria-label={t('quiz.markCorrect', { n: i + 1 })} data-testid={`quiz-correct-${i}`} />}
              <input value={o} maxLength={POLL_MAX_OPTION_TEXT} onChange={(e) => setOption(i, e.target.value)} placeholder={t('poll.addOption')}
                aria-label={t('poll.optionN', { n: i + 1 })} data-testid={`poll-option-${i}`} />
            </div>
          ))}
        </fieldset>
        <label className="toggle-row"><input type="checkbox" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} data-testid="poll-quiz" /> {t('quiz.mode')}</label>
        {quiz ? <>
          <p className="muted-text">{t('quiz.hint')}</p>
          <label className="field"><span>{t('quiz.explanation')}</span>
            <input value={explanation} maxLength={QUIZ_MAX_EXPLANATION} onChange={(e) => setExplanation(e.target.value)} data-testid="quiz-explanation" />
          </label>
        </> : <label className="toggle-row"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} data-testid="poll-multiple" /> {t('poll.multiple')}</label>}
        <p className="muted-text">{t('poll.visible')}</p>
        {error && <p role="alert" className="failed">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !question.trim() || filled.length < 1 || (quiz && (correct === null || !options[correct]?.trim()))} onClick={() => void send()} data-testid="poll-send">{t('poll.send')}</button>
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
  // Quizzes: one final answer; results and the correct option appear once answered (or closed).
  // The author knows the answer, so sees results from the start and does not answer.
  const quiz = isQuiz(poll);
  const author = message.authorId === client.accountId;
  const revealed = !quiz || author || mine.length > 0 || !!poll.closed;
  const locked = !!poll.closed || (quiz && (author || mine.length > 0));
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
    if (locked) return;
    const next = poll.multiple ? (mine.includes(optionId) ? mine.filter((o) => o !== optionId) : [...mine, optionId]) : (mine.includes(optionId) ? [] : [optionId]);
    void client.votePoll(message, next).catch(() => undefined);
  };
  const top = Math.max(1, ...Object.values(counts).map((v) => v.length));
  return (
    <div className={`poll-card${poll.closed ? ' closed' : ''}${quiz ? ' quiz' : ''}`} data-testid="poll-card" data-voters={voters} data-closed={poll.closed ? 'true' : 'false'}>
      <div className="poll-question"><Icon name="poll" size={16} /> {poll.question}</div>
      <div className="poll-mode muted-text">{poll.closed ? t('poll.closed') : quiz ? t('quiz.label') : poll.multiple ? t('poll.selectMany') : t('poll.selectOne')}</div>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const count = counts[o.id]?.length ?? 0;
          const chosen = mine.includes(o.id);
          const verdict = quiz && revealed ? (o.id === poll.correctOptionId ? ' correct' : chosen ? ' wrong' : '') : '';
          return (
            <li key={o.id}>
              <button className={`poll-option${chosen ? ' chosen' : ''}${verdict}`} onClick={() => toggle(o.id)} disabled={locked} role={poll.multiple ? 'checkbox' : 'radio'} aria-checked={chosen}
                data-testid="poll-option" data-verdict={verdict.trim() || undefined}>
                <span className={`poll-check${poll.multiple ? '' : ' round'}`} aria-hidden="true">{(chosen || verdict === ' correct') && <Icon name={verdict === ' wrong' ? 'close' : 'check'} size={14} />}</span>
                <span className="poll-option-text">{o.text}</span>
                {revealed && <span className="poll-count" data-testid="poll-count">{count}</span>}
                {revealed && <span className="poll-bar" style={{ width: `${(count / top) * 100}%` }} aria-hidden="true" />}
              </button>
              {showVotes && count > 0 && <div className="poll-voters muted-text">{counts[o.id]!.map((id) => names[id] ?? '…').join(', ')}</div>}
            </li>
          );
        })}
      </ul>
      {quiz && revealed && (
        <div className="quiz-result" data-testid="quiz-result">
          {mine.length > 0 && <strong>{t(mine[0] === poll.correctOptionId ? 'quiz.right' : 'quiz.wrong')}</strong>}
          {poll.explanation && <p>{poll.explanation}</p>}
          <span className="muted-text">{t('quiz.score', { correct: quizScore(poll).correct, answered: quizScore(poll).answered })}</span>
        </div>
      )}
      <div className="poll-actions">
        <button className="btn btn-ghost" onClick={() => setShowVotes((v) => !v)} data-testid="poll-view-votes">{showVotes ? t('poll.hideVotes') : t('poll.viewVotes', { count: voters })}</button>
        {canClose && !poll.closed && <button className="btn btn-ghost" onClick={() => void client.closePoll(message)} data-testid="poll-close">{t('poll.close')}</button>}
      </div>
    </div>
  );
}
