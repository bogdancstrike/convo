import { fromBase64Url, sha256, toBase64Url } from '../lib/bytes';

/**
 * Attachment encryption (specs §7.1, §27.4): the STREAM construction (Hoang, Reyhanitabar,
 * Rogaway, Vizár 2015) over AES-256-GCM with 64 KiB plaintext chunks, as used by Tink/age.
 *
 * Blob layout (version 1):
 *
 * ```
 * header (24 B): 0x01 | chunkSize u32 BE | plaintextLength u64 BE | noncePrefix (7 B) | reserved (4 B, zero)
 * chunk_i      : AES-GCM(key, nonce = noncePrefix || i u32 BE || lastFlag u8, aad = header) — 16 B tag each
 * padding      : zero bytes up to the size bucket (specs §5.5); length is implied by the header
 * ```
 *
 * The final-chunk flag and the authenticated header (with the exact plaintext length) prevent
 * truncation, extension and reordering. A fresh random 256-bit key is used per attachment, so
 * nonces never repeat under one key. The digest (SHA-256 of the whole padded blob) is verified
 * **before** any decryption (specs §7.2).
 *
 * This is a well-known construction, but its use here is part of the independent review scope
 * (SEC-02); the format is versioned so it can be replaced.
 */

export const CHUNK_SIZE = 64 * 1024;
const VERSION = 1;
const HEADER_SIZE = 24;
const TAG_SIZE = 16;
const PREFIX_SIZE = 7;

/** Result of encrypting one attachment. */
export interface EncryptedAttachment {
  blob: Uint8Array<ArrayBuffer>;
  /** Raw AES-256 key, base64url (travels only inside E2EE messages). */
  key: string;
  /** SHA-256 of `blob`, base64url. */
  digest: string;
  /** Key and nonce prefix; re-encrypting the same plaintext with them yields the same blob. */
  seed: AttachmentSeed;
}

/**
 * Key material that makes encryption reproducible for resumable uploads. Reuse it only for the
 * identical plaintext (callers check a plaintext digest): different plaintext under the same seed
 * would reuse nonces.
 */
export interface AttachmentSeed { key: string; prefix: string }

/** Padded ciphertext size bucket: `max(541, ceil(1.05^ceil(log_1.05(size))))`. */
export function paddedSize(size: number): number {
  return Math.max(541, Math.ceil(Math.pow(1.05, Math.ceil(Math.log(size) / Math.log(1.05)))));
}

function encryptedLength(plaintextLength: number): number {
  const chunks = Math.max(1, Math.ceil(plaintextLength / CHUNK_SIZE));
  return HEADER_SIZE + plaintextLength + chunks * TAG_SIZE;
}

function nonce(prefix: Uint8Array, index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12);
  n.set(prefix);
  new DataView(n.buffer).setUint32(PREFIX_SIZE, index);
  n[11] = last ? 1 : 0;
  return n;
}

/** Encrypts plaintext with a fresh key, or reproducibly with `seed` (same plaintext only). */
export async function encryptAttachment(plaintext: Uint8Array<ArrayBuffer>, seed?: AttachmentSeed): Promise<EncryptedAttachment> {
  const rawKey = seed ? fromBase64Url(seed.key) as Uint8Array<ArrayBuffer> : crypto.getRandomValues(new Uint8Array(32));
  const prefix = seed ? fromBase64Url(seed.prefix) as Uint8Array<ArrayBuffer> : crypto.getRandomValues(new Uint8Array(PREFIX_SIZE));
  if (rawKey.length !== 32 || prefix.length !== PREFIX_SIZE) throw new Error('invalid attachment seed');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);
  header[0] = VERSION;
  view.setUint32(1, CHUNK_SIZE);
  view.setBigUint64(5, BigInt(plaintext.length));
  header.set(prefix, 13);

  const blob = new Uint8Array(paddedSize(encryptedLength(plaintext.length)));
  blob.set(header);
  let offset = HEADER_SIZE;
  const chunks = Math.max(1, Math.ceil(plaintext.length / CHUNK_SIZE));
  for (let i = 0; i < chunks; i++) {
    const part = plaintext.subarray(i * CHUNK_SIZE, Math.min(plaintext.length, (i + 1) * CHUNK_SIZE));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, i, i === chunks - 1), additionalData: header }, key, part),
    );
    blob.set(sealed, offset);
    offset += sealed.length;
  }
  return { blob, key: toBase64Url(rawKey), digest: toBase64Url(await sha256(blob)), seed: { key: toBase64Url(rawKey), prefix: toBase64Url(prefix) } };
}

/** Why a downloaded attachment was rejected (UI.md §5.3 distinguishes failure reasons). */
export class AttachmentIntegrityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AttachmentIntegrityError';
  }
}

/**
 * Verifies the digest, then decrypts and authenticates every chunk.
 *
 * @param maxPlaintext refuse headers announcing more than this many bytes
 * @throws AttachmentIntegrityError on digest/format/authentication failure
 */
export async function decryptAttachment(
  blob: Uint8Array<ArrayBuffer>,
  keyB64: string,
  digestB64: string,
  maxPlaintext = 100 * 1024 * 1024,
): Promise<Uint8Array<ArrayBuffer>> {
  if (toBase64Url(await sha256(blob)) !== digestB64) throw new AttachmentIntegrityError('digest mismatch');
  if (blob.length < HEADER_SIZE + TAG_SIZE) throw new AttachmentIntegrityError('truncated');
  const header = blob.slice(0, HEADER_SIZE);
  const view = new DataView(header.buffer);
  if (header[0] !== VERSION) throw new AttachmentIntegrityError('unsupported version');
  const chunkSize = view.getUint32(1);
  const length = Number(view.getBigUint64(5));
  if (chunkSize !== CHUNK_SIZE || length > maxPlaintext || encryptedLength(length) > blob.length) {
    throw new AttachmentIntegrityError('invalid header');
  }
  const prefix = header.subarray(13, 13 + PREFIX_SIZE);
  const key = await crypto.subtle.importKey('raw', fromBase64Url(keyB64), 'AES-GCM', false, ['decrypt']);
  const out = new Uint8Array(length);
  const chunks = Math.max(1, Math.ceil(length / CHUNK_SIZE));
  let offset = HEADER_SIZE;
  for (let i = 0; i < chunks; i++) {
    const plainLength = Math.min(CHUNK_SIZE, length - i * CHUNK_SIZE);
    const sealed = blob.subarray(offset, offset + plainLength + TAG_SIZE);
    offset += sealed.length;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce(prefix, i, i === chunks - 1), additionalData: header },
        key,
        sealed,
      );
      out.set(new Uint8Array(plain), i * CHUNK_SIZE);
    } catch {
      throw new AttachmentIntegrityError('authentication failed');
    }
  }
  return out;
}
