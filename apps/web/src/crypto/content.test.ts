import { describe, expect, it } from 'vitest';
import { utf8 } from '../lib/bytes';
import { decodeContent, encodeContent, newMessageId } from './content';
import { pad } from './padding';

describe('content codec', () => {
  it('round-trips a data message', () => {
    const content = { v: 1, kind: 'data' as const, data: { messageId: newMessageId(), timestamp: 1, body: 'Bună ziua ș ț' } };
    expect(decodeContent(encodeContent(content))).toEqual(content);
  });

  it('maps unknown kinds to an unknown placeholder', () => {
    expect(decodeContent(pad(utf8(JSON.stringify({ v: 2, kind: 'poll' }))))).toEqual({ v: 2, kind: 'unknown' });
  });

  it('rejects malformed known kinds', () => {
    expect(() => decodeContent(pad(utf8(JSON.stringify({ v: 1, kind: 'data', data: { body: 'x' } }))))).toThrow();
  });
});

describe('acknowledgement request deadlines', () => {
  const request = (extra: object) => ({ requestId: newMessageId(), revision: 1, reviewers: [newMessageId()], audience: [newMessageId()], ...extra });
  const data = (ackRequest: object) => ({ v: 1, kind: 'data' as const, data: { messageId: newMessageId(), timestamp: 1, body: 'Rules', ackRequest } });

  it('accepts optional due and closing times', () => {
    const content = data(request({ due: 1_000, expires: 2_000 }));
    expect(decodeContent(encodeContent(content as never))).toEqual(content);
  });

  it('rejects a due time after the closing time or a non-integer time', () => {
    expect(() => decodeContent(encodeContent(data(request({ due: 3_000, expires: 2_000 })) as never))).toThrow();
    expect(() => decodeContent(encodeContent(data(request({ due: 'tomorrow' })) as never))).toThrow();
  });
});
