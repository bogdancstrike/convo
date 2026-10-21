import { describe, expect, it } from 'vitest';
import { ackClosed } from './client';

describe('ackClosed', () => {
  const base = { requestId: 'r', revision: 1, reviewers: ['a'], audience: ['b'] };
  it('stays open without a closing time and until the closing time passes', () => {
    expect(ackClosed(base, 10)).toBe(false);
    expect(ackClosed({ ...base, expires: 10 }, 10)).toBe(false);
    expect(ackClosed({ ...base, expires: 10 }, 11)).toBe(true);
  });
});
