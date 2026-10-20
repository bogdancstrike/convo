import { describe, expect, it } from 'vitest';
import { BUCKET, pad, unpad } from './padding';

describe('padding', () => {
  it('pads to bucket boundaries and round-trips', () => {
    for (const len of [0, 1, BUCKET - 1, BUCKET, BUCKET + 1, 1000]) {
      const plain = new Uint8Array(len).fill(0x41);
      const padded = pad(plain);
      expect(padded.length % BUCKET).toBe(0);
      expect(padded.length).toBeGreaterThan(len);
      expect(Array.from(unpad(padded))).toEqual(Array.from(plain));
    }
  });

  it('preserves trailing zero bytes of the plaintext', () => {
    const plain = new Uint8Array([1, 0, 0]);
    expect(Array.from(unpad(pad(plain)))).toEqual([1, 0, 0]);
  });

  it('rejects input without a terminator', () => {
    expect(() => unpad(new Uint8Array(BUCKET))).toThrow();
  });
});
