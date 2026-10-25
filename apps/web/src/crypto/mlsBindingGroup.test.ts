import libsignal, { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, randomBytes } from '../lib/bytes';
import { createGroupWith, decodeKeyPackageMessage, generateKeyPackages, generateSigner, keyPackageSignatureKey, memberKeys } from './mls';
import { signBinding, verifyBinding } from './mlsBinding';

/** GRP-01: a server-substituted KeyPackage under a real device address is caught by its binding. */
describe('device bindings on real MLS state', async () => {
  await libsignal();
  const bobIdentity = await KeyHelper.generateIdentityKeyPair();
  const bobPub = new Uint8Array(bobIdentity.pubKey);
  const bobSigner = await generateSigner();
  const published = { signatureKey: fromBase64Url(bobSigner.publicKey),
    binding: await signBinding(new Uint8Array(bobIdentity.privKey), 'acme', 'bob', 1, fromBase64Url(bobSigner.publicKey)) };

  it("Bob's own KeyPackage and leaf verify; a forged one under bob.1 does not", async () => {
    const genuine = decodeKeyPackageMessage((await generateKeyPackages(bobSigner, 'bob', 1, 1))[0]!.message);
    expect(await verifyBinding(bobPub, 'acme', 'bob', 1, keyPackageSignatureKey(genuine), published)).toBe('bound');

    // The server mints a KeyPackage claiming to be bob.1 with its own signature key.
    const forged = decodeKeyPackageMessage((await generateKeyPackages(await generateSigner(), 'bob', 1, 1))[0]!.message);
    expect(await verifyBinding(bobPub, 'acme', 'bob', 1, keyPackageSignatureKey(forged), published)).toBe('invalid');

    // In a group, the leaf audit sees the same keys.
    const alice = await generateSigner();
    const aliceKp = (await generateKeyPackages(alice, 'alice', 1, 1))[0]!;
    const group = await createGroupWith(alice, aliceKp, randomBytes(32), [genuine, forged].slice(0, 1));
    const bobLeaf = memberKeys(group.state).find((l) => l.identity === 'bob.1')!;
    expect(await verifyBinding(bobPub, 'acme', 'bob', 1, bobLeaf.signatureKey, published)).toBe('bound');
  });
});
