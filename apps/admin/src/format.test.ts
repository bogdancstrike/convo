import { describe, expect, it } from 'vitest';
import { seconds } from './format';

describe('seconds', () => {
  it('parses ISO-8601 durations from the server', () => {
    expect(seconds('PT0S')).toBe(0);
    expect(seconds('PT1M30.5S')).toBe(90.5);
    expect(seconds('PT2H')).toBe(7200);
    expect(seconds('garbage')).toBe(0);
  });
});
