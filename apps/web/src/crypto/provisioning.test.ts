import { describe, expect, it } from 'vitest';
import {
  comparisonCode,
  generateEphemeral,
  openProvisionMessage,
  provisioningTranscript,
  sealProvisionMessage,
  type ProvisionMessage,
} from './provisioning';

describe('provisioning channel', async () => {
  const newDevice = await generateEphemeral();
  const transcript = {
    deploymentId: 'enclave-dev',
    accountId: 'acc-1',
    provisioningId: 'pid-1',
    deviceId: 2,
    ephemeralPublicKey: newDevice.publicKey,
    challenge: 'challenge',
  };
  const message: ProvisionMessage = {
    v: 1,
    accountId: 'acc-1',
    username: 'ana',
    identityPublic: 'pub',
    identityPrivate: 'priv',
    provisioningCode: 'code',
    readReceipts: false,
  };

  it('round-trips the ProvisionMessage between ephemeral keys', async () => {
    const sealed = await sealProvisionMessage(message, transcript);
    await expect(openProvisionMessage(newDevice.keyPair.privateKey, sealed.ephemeralPublicKey, sealed.message, transcript)).resolves.toEqual(
      message,
    );
  });

  it('rejects ciphertext bound to a different transcript (swapped session/key)', async () => {
    const sealed = await sealProvisionMessage(message, transcript);
    await expect(
      openProvisionMessage(newDevice.keyPair.privateKey, sealed.ephemeralPublicKey, sealed.message, { ...transcript, deviceId: 3 }),
    ).rejects.toThrow();
  });

  it('derives a stable 12-digit comparison code that changes with the transcript', async () => {
    const a = await comparisonCode(provisioningTranscript(transcript));
    expect(a).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(await comparisonCode(provisioningTranscript(transcript))).toBe(a);
    expect(await comparisonCode(provisioningTranscript({ ...transcript, provisioningId: 'pid-2' }))).not.toBe(a);
  });
});
