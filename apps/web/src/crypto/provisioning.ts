import { fromBase64Url, fromUtf8, sha256, toBase64Url, utf8 } from '../lib/bytes';

/**
 * Device-linking channel (specs §4.4, §27.1): X25519 ephemeral ECDH → HKDF-SHA256 → AES-256-GCM,
 * bound to a canonical transcript. Uses WebCrypto primitives only.
 *
 * Transcript (`ENCLAVE-PROVISION-V1`) binds deployment, account, session, reserved address, the new
 * device's ephemeral key and the reservation challenge. It is the GCM additional data, the HKDF
 * salt input, and the source of the 12-digit comparison code both screens display.
 */

export const PROVISION_VERSION = 'ENCLAVE-PROVISION-V1';

export interface ProvisioningTranscriptInput {
  deploymentId: string;
  accountId: string;
  provisioningId: string;
  deviceId: number;
  ephemeralPublicKey: string;
  challenge: string;
}

/** Decrypted ProvisionMessage (specs §4.4); travels only inside the E2EE channel. */
export interface ProvisionMessage {
  v: 1;
  accountId: string;
  username: string;
  identityPublic: string;
  identityPrivate: string;
  provisioningCode: string;
  readReceipts: boolean;
}

/** Canonical transcript bytes. */
export function provisioningTranscript(t: ProvisioningTranscriptInput): Uint8Array<ArrayBuffer> {
  return utf8(
    [PROVISION_VERSION, t.deploymentId, t.accountId, t.provisioningId, `${t.accountId}.${t.deviceId}`, t.ephemeralPublicKey, t.challenge].join(
      '\n',
    ),
  );
}

/** 12-digit comparison code shown on both devices, formatted `123 456 789 012`. */
export async function comparisonCode(transcript: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await sha256(utf8(`${PROVISION_VERSION} comparison\n${toBase64Url(transcript)}`));
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(digest[i]!);
  const digits = (value % 10n ** 12n).toString().padStart(12, '0');
  return digits.match(/.{3}/g)!.join(' ');
}

/** A new X25519 key pair; the public key is exported raw (32 bytes, base64url). */
export async function generateEphemeral(): Promise<{ keyPair: CryptoKeyPair; publicKey: string }> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  return { keyPair, publicKey: toBase64Url(await crypto.subtle.exportKey('raw', keyPair.publicKey)) };
}

async function channelKey(privateKey: CryptoKey, peerPublic: string, transcript: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey('raw', fromBase64Url(peerPublic), { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: await sha256(transcript), info: utf8(`${PROVISION_VERSION} aes-256-gcm`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Approving device: encrypts the ProvisionMessage to the new device's ephemeral key.
 *
 * @returns the approver's ephemeral public key and `iv || ciphertext`, both base64url
 */
export async function sealProvisionMessage(
  message: ProvisionMessage,
  transcriptInput: ProvisioningTranscriptInput,
): Promise<{ ephemeralPublicKey: string; message: string }> {
  const transcript = provisioningTranscript(transcriptInput);
  const ephemeral = await generateEphemeral();
  const key = await channelKey(ephemeral.keyPair.privateKey, transcriptInput.ephemeralPublicKey, transcript);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: transcript }, key, utf8(JSON.stringify(message))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return { ephemeralPublicKey: ephemeral.publicKey, message: toBase64Url(out) };
}

/**
 * New device: decrypts and validates the ProvisionMessage.
 *
 * @throws Error if authentication fails or the message does not belong to the expected account
 */
export async function openProvisionMessage(
  privateKey: CryptoKey,
  approverPublicKey: string,
  sealed: string,
  transcriptInput: ProvisioningTranscriptInput,
): Promise<ProvisionMessage> {
  const transcript = provisioningTranscript(transcriptInput);
  const key = await channelKey(privateKey, approverPublicKey, transcript);
  const bytes = fromBase64Url(sealed);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: transcript },
    key,
    bytes.subarray(12),
  );
  const message = JSON.parse(fromUtf8(plain)) as ProvisionMessage;
  if (message.v !== 1 || message.accountId !== transcriptInput.accountId || !message.provisioningCode || !message.identityPrivate) {
    throw new Error('invalid provision message');
  }
  return message;
}
