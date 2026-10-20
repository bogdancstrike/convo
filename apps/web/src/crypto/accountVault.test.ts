import { describe, expect, it } from 'vitest';
import { openVault, sealVault, vaultKey } from './accountVault';
import { randomBytes } from '../lib/bytes';
describe('account vault', () => {
  it('binds ciphertext to account/context, uses randomized encryption, rejects tampering and wrong secrets', async () => {
    const key = await vaultKey(randomBytes(32), 'archive/account');
    const one = await sealVault(key, { secret: 'private' }, 'account/entry');
    expect(await sealVault(key, { secret: 'private' }, 'account/entry')).not.toBe(one);
    expect(await openVault(key, one, 'account/entry')).toEqual({ secret: 'private' });
    await expect(openVault(key, one, 'other/entry')).rejects.toThrow();
    await expect(openVault(await vaultKey(randomBytes(32), 'archive/account'), one, 'account/entry')).rejects.toThrow();
    await expect(openVault(key, 'a'.repeat(one.length), 'account/entry')).rejects.toThrow();
  });
});
