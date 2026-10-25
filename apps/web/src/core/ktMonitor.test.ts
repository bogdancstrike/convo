import { expect, it, vi } from 'vitest';
import { mustBlock, type KtAccountRecord } from './ktMonitor';

const record = (status: KtAccountRecord['status']): KtAccountRecord => ({ status, identityKey: 'k', deviceListVersion: 1, checkedAt: 0, size: 1 });
const monitor = (stored?: KtAccountRecord, fresh?: KtAccountRecord) => ({ status: vi.fn(async () => stored), check: vi.fn(async () => fresh) });

it('never blocks when the policy is warn-only', async () => {
  const m = monitor(record('mismatch'), record('mismatch'));
  expect(await mustBlock(m, 'a', false)).toBe(false);
  expect(m.status).not.toHaveBeenCalled();
});

it('does not re-check accounts that passed or were never checked', async () => {
  for (const stored of [record('verified'), record('unwitnessed'), record('stale'), undefined]) {
    const m = monitor(stored);
    expect(await mustBlock(m, 'a', true)).toBe(false);
    expect(m.check).not.toHaveBeenCalled();
  }
});

it('blocks only when a fresh check still fails', async () => {
  expect(await mustBlock(monitor(record('mismatch'), record('mismatch')), 'a', true)).toBe(true);
  expect(await mustBlock(monitor(record('log-error'), record('log-error')), 'a', true)).toBe(true);
  expect(await mustBlock(monitor(record('mismatch'), record('verified')), 'a', true)).toBe(false);
  // Offline re-check keeps the previous (failed) result: still blocked.
  expect(await mustBlock(monitor(record('mismatch'), record('mismatch')), 'a', true)).toBe(true);
});
