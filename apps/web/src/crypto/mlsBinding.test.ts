import libsignal, { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { describe, expect, it } from 'vitest';
import { signBinding, verifyBinding } from './mlsBinding';

describe('MLS device bindings (GRP-01)', async () => {
  await libsignal();
  const identity = await KeyHelper.generateIdentityKeyPair();
  const other = await KeyHelper.generateIdentityKeyPair();
  const pub = new Uint8Array(identity.pubKey); const priv = new Uint8Array(identity.privKey);
  const key = crypto.getRandomValues(new Uint8Array(32));
  const binding = await signBinding(priv, 'acme', 'acct', 2, key);
  it('a binding signed by the account identity key verifies for that device and key', async () => {
    expect(await verifyBinding(pub, 'acme', 'acct', 2, key, { signatureKey: key, binding })).toBe('bound');
  });
  it('rejects another key, device, deployment or signer', async () => {
    const otherKey = crypto.getRandomValues(new Uint8Array(32));
    expect(await verifyBinding(pub, 'acme', 'acct', 2, otherKey, { signatureKey: key, binding })).toBe('invalid'); // leaf key differs
    expect(await verifyBinding(pub, 'acme', 'acct', 3, key, { signatureKey: key, binding })).toBe('invalid');
    expect(await verifyBinding(pub, 'other', 'acct', 2, key, { signatureKey: key, binding })).toBe('invalid');
    expect(await verifyBinding(new Uint8Array(other.pubKey), 'acme', 'acct', 2, key, { signatureKey: key, binding })).toBe('invalid');
  });
  it('a device without a published binding is unbound, not invalid', async () => {
    expect(await verifyBinding(pub, 'acme', 'acct', 2, key, undefined)).toBe('unbound');
  });
});
