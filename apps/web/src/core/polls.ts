import { POLL_MAX_OPTION_TEXT, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, QUIZ_MAX_EXPLANATION, type PollDefinition, type PollVote } from '../crypto/content';

/**
 * Polls (FR-EXT-01, AC-COL-01): an encrypted poll message with immutable option IDs, visible
 * ballots (no anonymity claim), one current ballot per account and an authorized close.
 *
 * Ballots are ordinary E2EE data messages. Every device applies them with the same rules, so all
 * members converge on the same result regardless of delivery order: the newest ballot per voter
 * wins (sender timestamp, then message ID as a deterministic tie-break), ballots for unknown
 * options or too many choices are ignored, and nothing changes after the poll is closed.
 *
 * Quizzes are single-choice polls with a correct option: each account's *first* answer is final
 * (earliest timestamp, then message ID), and withdrawing is not possible. The correct answer travels
 * inside the encrypted poll, so clients hide it until you answer; this is a UI convention, not a
 * secret from members.
 */
export interface Ballot { optionIds: string[]; at: number; id: string }
export interface PollState extends PollDefinition {
  /** Current ballot per voter account. */
  votes: Record<string, Ballot>;
  closed?: { by: string; at: number };
}

/** Builds a validated definition from user input (trims, drops empty options, assigns IDs). */
export function newPoll(question: string, options: string[], multiple: boolean, id: () => string): PollDefinition {
  const q = question.trim();
  const texts = options.map((o) => o.trim()).filter(Boolean);
  if (!q || q.length > POLL_MAX_QUESTION) throw new Error('poll question missing or too long');
  if (texts.length < 1 || texts.length > POLL_MAX_OPTIONS) throw new Error(`a poll needs 1–${POLL_MAX_OPTIONS} options`);
  if (texts.some((t) => t.length > POLL_MAX_OPTION_TEXT)) throw new Error('poll option too long');
  return { question: q, options: texts.map((text) => ({ id: id(), text })), multiple };
}

/** A quiz: single choice with the option at `correctIndex` (of the non-empty options) marked correct. */
export function newQuiz(question: string, options: string[], correctIndex: number, explanation: string | undefined, id: () => string): PollDefinition {
  const poll = newPoll(question, options, false, id);
  const correct = poll.options[correctIndex];
  if (!correct) throw new Error('quiz needs a correct answer');
  const text = explanation?.trim();
  if (text && text.length > QUIZ_MAX_EXPLANATION) throw new Error('explanation too long');
  return { ...poll, correctOptionId: correct.id, ...(text ? { explanation: text } : {}) };
}

export function isQuiz(poll: PollDefinition): boolean { return poll.correctOptionId !== undefined; }

/** Correct answers among the current ballots (quizzes). */
export function quizScore(state: PollState): { correct: number; answered: number } {
  const ballots = Object.values(state.votes).filter((b) => b.optionIds.length);
  return { correct: ballots.filter((b) => b.optionIds[0] === state.correctOptionId).length, answered: ballots.length };
}

export function initialState(poll: PollDefinition): PollState { return { ...poll, votes: {} }; }

/** A ballot replaces the voter's earlier one when it is newer; invalid or late ballots are ignored. */
export function applyBallot(state: PollState, voter: string, vote: Pick<PollVote, 'optionIds'>, at: number, id: string): PollState {
  if (state.closed && at > state.closed.at) return state;
  const valid = new Set(state.options.map((o) => o.id));
  if (!vote.optionIds.every((o) => valid.has(o)) || (!state.multiple && vote.optionIds.length > 1)) return state;
  const current = state.votes[voter];
  if (isQuiz(state)) {
    // Quiz answers are final: the earliest non-empty answer wins; withdrawing is ignored.
    if (!vote.optionIds.length) return state;
    if (current && (current.at < at || (current.at === at && current.id <= id))) return state;
  } else if (current && (current.at > at || (current.at === at && current.id >= id))) return state;
  return { ...state, votes: { ...state.votes, [voter]: { optionIds: [...vote.optionIds], at, id } } };
}

/** Closing is final; the earliest authorized close wins. */
export function applyClose(state: PollState, by: string, at: number): PollState {
  if (state.closed && state.closed.at <= at) return state;
  // Ballots sent after the (earlier) close no longer count.
  const votes = Object.fromEntries(Object.entries(state.votes).filter(([, b]) => b.at <= at));
  return { ...state, votes, closed: { by, at } };
}

/** Per-option counts and voter lists, plus the number of people who voted. */
export function tally(state: PollState): { counts: Record<string, string[]>; voters: number } {
  const counts: Record<string, string[]> = Object.fromEntries(state.options.map((o) => [o.id, []]));
  let voters = 0;
  for (const [account, ballot] of Object.entries(state.votes)) {
    if (!ballot.optionIds.length) continue;
    voters++;
    for (const option of ballot.optionIds) counts[option]?.push(account);
  }
  return { counts, voters };
}
