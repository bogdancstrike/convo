import 'fake-indexeddb/auto';
import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@privacyresearch/libsignal-protocol-typescript';
import { describe, expect, it } from 'vitest';
import { fromBinaryString, toArrayBuffer, toBase64Url } from '../lib/bytes';
import { EncryptedStore } from '../storage/encryptedStore';
import { SignalStore } from './signalStore';

async function party(name: string) {
  const store = new SignalStore(await EncryptedStore.open(`${name}-${Math.random()}`));
  const ik = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  await store.saveLocalIdentity({
    identityPublic: toBase64Url(ik.pubKey),
    identityPrivate: toBase64Url(ik.privKey),
    registrationId,
  });
  const spk = await KeyHelper.generateSignedPreKey(ik, 1);
  const opk = await KeyHelper.generatePreKey(7);
  await store.storeSignedPreKey(1, spk.keyPair);
  await store.storePreKey(7, opk.keyPair);
  const bundle = {
    identityKey: ik.pubKey,
    registrationId,
    signedPreKey: { keyId: 1, publicKey: spk.keyPair.pubKey, signature: spk.signature },
    preKey: { keyId: 7, publicKey: opk.keyPair.pubKey },
  };
  return { store, ik, bundle };
}

describe('SignalStore with libsignal-protocol-typescript', () => {
  it('uses 33-byte DJB identity keys (server format check)', async () => {
    const ik = await KeyHelper.generateIdentityKeyPair();
    const pub = new Uint8Array(ik.pubKey);
    expect(pub.length).toBe(33);
    expect(pub[0]).toBe(5);
  });

  it('establishes a session and exchanges messages both ways, with buffered state commits', async () => {
    const alice = await party('alice');
    const bob = await party('bob');
    const bobAddr = new SignalProtocolAddress('bob-account', 1);
    const aliceAddr = new SignalProtocolAddress('alice-account', 1);

    await new SessionBuilder(alice.store, bobAddr).processPreKey(bob.bundle);
    const first = await new SessionCipher(alice.store, bobAddr).encrypt(toArrayBuffer(new TextEncoder().encode('hi bob')));
    expect(first.type).toBe(3);

    const { result, ops } = await bob.store.unitOfWork(() =>
      new SessionCipher(bob.store, aliceAddr).decryptPreKeyWhisperMessage(first.body!, 'binary'),
    );
    expect(new TextDecoder().decode(result)).toBe('hi bob');
    expect(ops.some((o) => o.type === 'put' && o.ns === 'session')).toBe(true);
    // Nothing persisted before commit: a crash here would leave Bob able to retry.
    expect(await bob.store.loadSession(aliceAddr.toString())).toBeUndefined();

    // Commit and reply.
    const encrypted = (bob.store as unknown as { store: EncryptedStore }).store;
    await encrypted.commit(ops);
    const reply = await new SessionCipher(bob.store, aliceAddr).encrypt(toArrayBuffer(new TextEncoder().encode('hi alice')));
    expect(reply.type).toBe(1);
    const plain = await new SessionCipher(alice.store, bobAddr).decryptWhisperMessage(fromBinaryString(reply.body!).buffer, undefined);
    expect(new TextDecoder().decode(plain)).toBe('hi alice');
  });

  it('blocks a changed identity key of a verified peer', async () => {
    const alice = await party('alice');
    const bob = await party('bob');
    const other = await party('mallory');
    const addr = new SignalProtocolAddress('bob-account', 1);
    await new SessionBuilder(alice.store, addr).processPreKey(bob.bundle);
    await alice.store.setVerified('bob-account', true);
    await expect(new SessionBuilder(alice.store, addr).processPreKey(other.bundle)).rejects.toThrow();
  });
});
