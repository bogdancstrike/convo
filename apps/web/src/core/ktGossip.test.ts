import { expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { readFileSync } from 'node:fs';
import { ApiError } from '../api/errors';
import { fromBase64Url, toBase64Url } from '../lib/bytes';
import { headBytes, type KtSignedHead } from './keyTransparency';
import { KeyTransparencyMonitor } from './ktMonitor';

const V = JSON.parse(readFileSync(new URL('../../../../contracts/vectors/kt-v1.json', import.meta.url), 'utf8'));
const logPriv = ed25519.utils.randomSecretKey();
const logKey = toBase64Url(ed25519.getPublicKey(logPriv));
const sign = (size: number, root: string, priv = logPriv): KtSignedHead =>
  ({ size, root, timestamp: 1000 + size, signature: toBase64Url(ed25519.sign(headBytes('d', size, fromBase64Url(root), 1000 + size), priv)) });

function setup(mineSize: number, consistency?: (from: number, to: number) => Promise<{ proof: string[] }>) {
  const data = new Map<string, unknown>();
  const store = {
    get: async (ns: string, id: string) => data.get(`${ns}/${id}`),
    put: async (ns: string, id: string, v: unknown) => { data.set(`${ns}/${id}`, v); },
    list: async () => [],
  };
  const mine = sign(mineSize, V.roots[String(mineSize)]);
  data.set('kt/state', { logKey, last: mine });
  const api = { ktConsistency: vi.fn(consistency ?? (async (from: number, to: number) => ({ proof: V.consistency.find((p: { from: number; to: number }) => p.from === from && p.to === to).proof }))) };
  const onSplit = vi.fn();
  const monitor = new KeyTransparencyMonitor(api as never, store as never, 'd', async () => 'ik', () => undefined, onSplit);
  return { monitor, api, onSplit, mine };
}

it('accepts consistent heads in either direction and ignores unsigned ones', async () => {
  const { monitor, onSplit } = setup(5);
  await monitor.compareGossip(sign(7, V.roots['7']));
  await monitor.compareGossip(sign(3, V.roots['3']));
  await monitor.compareGossip(sign(6, V.roots['2'], ed25519.utils.randomSecretKey())); // not our log: ignored
  await monitor.compareGossip({ size: 'x' });
  expect(onSplit).not.toHaveBeenCalled();
  expect(await monitor.evidence()).toBeUndefined();
});

it('keeps evidence when two signed heads of the same size differ', async () => {
  const { monitor, onSplit, mine } = setup(5);
  const other = sign(5, V.roots['4']);
  await monitor.compareGossip(other);
  expect(onSplit).toHaveBeenCalledOnce();
  expect(await monitor.evidence()).toMatchObject({ reason: 'split-view', heads: [mine, other] });
});

it('flags a signed head that does not extend ours', async () => {
  const { monitor, onSplit } = setup(5);
  await monitor.compareGossip(sign(7, V.roots['6'])); // proof for 5→7 cannot connect to this root
  expect(onSplit).toHaveBeenCalledOnce();
});

it('flags a newer signed head the server refuses to prove', async () => {
  const { monitor, onSplit } = setup(5, async () => { throw new ApiError(400, 'INVALID_REQUEST', 'invalid sizes'); });
  await monitor.compareGossip(sign(7, V.roots['7']));
  expect(onSplit).toHaveBeenCalledOnce();
});

it('after a split view every check reports a log error, and network failures raise no alarm', async () => {
  const { monitor } = setup(5);
  await monitor.compareGossip(sign(5, V.roots['4']));
  expect(await monitor.check('someone', { accountId: 'someone', deviceListVersion: 1, devices: [] }, true)).toMatchObject({ status: 'log-error', reason: 'split-view' });
  const offline = setup(5, async () => { throw new Error('offline'); });
  await offline.monitor.compareGossip(sign(7, V.roots['7']));
  expect(offline.onSplit).not.toHaveBeenCalled();
});
