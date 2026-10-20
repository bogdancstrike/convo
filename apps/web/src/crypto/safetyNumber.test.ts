import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript';
import { expect, it } from 'vitest';
import { toBase64Url } from '../lib/bytes';
import { safetyNumber } from './safetyNumber';

it('keeps the exact pinned library fingerprint, including identifier ordering and all 5200 rounds', async () => {
  const local = new Uint8Array(33).fill(7); local[0] = 5;
  const remote = new Uint8Array(33).fill(19); remote[0] = 5;
  const expected = await new FingerprintGenerator(5200).createFor('account-a', local.buffer, 'account-b', remote.buffer);
  const digits = safetyNumber('account-a', toBase64Url(local), 'account-b', toBase64Url(remote));
  expect(digits).toBe(expected); expect(digits).toMatch(/^\d{60}$/);
  expect(safetyNumber('account-b', toBase64Url(remote), 'account-a', toBase64Url(local))).toBe(digits);
  expect(safetyNumber('account-a', toBase64Url(remote), 'account-b', toBase64Url(local))).not.toBe(digits);
});
