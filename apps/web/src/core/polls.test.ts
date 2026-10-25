import { describe, expect, it } from 'vitest';
import { decodeContent, encodeContent, CONTENT_VERSION } from '../crypto/content';
import { applyBallot, applyClose, initialState, newPoll, tally } from './polls';

let n = 0;
const id = () => `o${++n}`;

describe('polls (AC-COL-01)', () => {
  it('accepts 1 and 10 options and rejects 0 or 11', () => {
    expect(newPoll('Lunch?', ['Pizza'], false, id).options).toHaveLength(1);
    expect(newPoll('Pick', Array.from({ length: 10 }, (_, i) => `#${i}`), true, id).options).toHaveLength(10);
    expect(() => newPoll('Pick', [], false, id)).toThrow();
    expect(() => newPoll('Pick', Array.from({ length: 11 }, (_, i) => `#${i}`), false, id)).toThrow();
    expect(() => newPoll('  ', ['a'], false, id)).toThrow();
  });

  it('keeps one current ballot per voter, newest wins, deterministic regardless of order', () => {
    const poll = initialState({ question: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], multiple: false });
    const first = applyBallot(applyBallot(poll, 'ana', { optionIds: ['a'] }, 1, 'm1'), 'ana', { optionIds: ['b'] }, 2, 'm2');
    const reversed = applyBallot(applyBallot(poll, 'ana', { optionIds: ['b'] }, 2, 'm2'), 'ana', { optionIds: ['a'] }, 1, 'm1');
    expect(first.votes.ana!.optionIds).toEqual(['b']);
    expect(reversed).toEqual(first);
    const tie = applyBallot(applyBallot(poll, 'ana', { optionIds: ['a'] }, 5, 'x2'), 'ana', { optionIds: ['b'] }, 5, 'x1');
    expect(tie.votes.ana!.optionIds).toEqual(['a']);
  });

  it('rejects unknown options and multiple choices in a single-choice poll; withdrawing empties the ballot', () => {
    const single = initialState({ question: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], multiple: false });
    expect(applyBallot(single, 'bob', { optionIds: ['zzz'] }, 1, 'm')).toBe(single);
    expect(applyBallot(single, 'bob', { optionIds: ['a', 'b'] }, 1, 'm')).toBe(single);
    const multi = { ...single, multiple: true };
    const voted = applyBallot(multi, 'bob', { optionIds: ['a', 'b'] }, 1, 'm');
    expect(tally(voted)).toEqual({ counts: { a: ['bob'], b: ['bob'] }, voters: 1 });
    expect(tally(applyBallot(voted, 'bob', { optionIds: [] }, 2, 'n')).voters).toBe(0);
  });

  it('closing is final and excludes ballots cast after it, whatever order they arrive in', () => {
    const poll = initialState({ question: 'Q', options: [{ id: 'a', text: 'A' }], multiple: false });
    const lateFirst = applyClose(applyBallot(poll, 'cy', { optionIds: ['a'] }, 20, 'm'), 'owner', 10);
    const closeFirst = applyBallot(applyClose(poll, 'owner', 10), 'cy', { optionIds: ['a'] }, 20, 'm');
    expect(tally(lateFirst).voters).toBe(0);
    expect(closeFirst).toEqual(lateFirst);
    expect(applyClose(lateFirst, 'other', 30).closed).toEqual({ by: 'owner', at: 10 });
  });

  it('round-trips through the content codec and rejects malformed definitions', () => {
    const poll = { question: 'Q', options: [{ id: 'a', text: 'A' }], multiple: false };
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, body: 'Q', poll } });
    expect(decodeContent(ok)).toMatchObject({ data: { poll } });
    const dup = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, poll: { ...poll, options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] } } });
    expect(() => decodeContent(dup)).toThrow();
  });
});
