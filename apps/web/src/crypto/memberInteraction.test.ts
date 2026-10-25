import { expect, it } from 'vitest';
import { CONTENT_VERSION, isMemberInteraction, type Content, type DataMessage } from './content';

const data = (d: Partial<DataMessage>): Content => ({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, ...d } });
const target = { targetMessageId: 't', targetAuthorId: 'a' };

it('accepts exactly one reaction, ballot or RSVP with envelope fields', () => {
  expect(isMemberInteraction(data({ reaction: { ...target, emoji: '👍' } }))).toBe(true);
  expect(isMemberInteraction(data({ pollVote: { ...target, optionIds: ['x'] }, expireTimer: 60, topic: 't1' }))).toBe(true);
  expect(isMemberInteraction(data({ rsvp: { ...target, response: 'yes' } }))).toBe(true);
});

it('rejects posts, mixed content and other kinds', () => {
  expect(isMemberInteraction(data({ body: 'hello' }))).toBe(false);
  expect(isMemberInteraction(data({ reaction: { ...target, emoji: '👍' }, body: 'smuggled text' }))).toBe(false);
  expect(isMemberInteraction(data({ reaction: { ...target, emoji: '👍' }, pollVote: { ...target, optionIds: [] } }))).toBe(false);
  expect(isMemberInteraction(data({ pollClose: target }))).toBe(false);
  expect(isMemberInteraction({ v: CONTENT_VERSION, kind: 'typing', typing: { action: 'started', timestamp: 1 } } as Content)).toBe(false);
});
