import { describe, expect, it } from 'vitest';
import { sha256, toBase64Url } from '../lib/bytes';
import { CHUNK_SIZE, decryptAttachment, encryptAttachment, paddedSize } from './attachmentCipher';

function bytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('attachment cipher (STREAM / AES-GCM)', () => {
  it.each([0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE + 5])('round-trips %i bytes', async (n) => {
    const plain = bytes(n);
    const enc = await encryptAttachment(plain);
    expect(enc.blob.length).toBeGreaterThanOrEqual(24 + n + 16);
    expect(enc.blob.length).toBe(paddedSize(24 + n + Math.max(1, Math.ceil(n / CHUNK_SIZE)) * 16));
    expect(Array.from(await decryptAttachment(enc.blob, enc.key, enc.digest))).toEqual(Array.from(plain));
  });

  it('rejects a digest mismatch before decrypting', async () => {
    const enc = await encryptAttachment(bytes(100));
    enc.blob[40] = enc.blob[40]! ^ 1;
    await expect(decryptAttachment(enc.blob, enc.key, enc.digest)).rejects.toThrow('digest mismatch');
  });

  it('rejects tampered ciphertext even when the digest is recomputed (truncation/reordering)', async () => {
    const enc = await encryptAttachment(bytes(2 * CHUNK_SIZE + 10));
    // Swap the first two chunks and recompute the digest: STREAM nonces/order must fail.
    const chunk = CHUNK_SIZE + 16;
    const first = enc.blob.slice(24, 24 + chunk);
    enc.blob.copyWithin(24, 24 + chunk, 24 + 2 * chunk);
    enc.blob.set(first, 24 + chunk);
    await expect(decryptAttachment(enc.blob, enc.key, toBase64Url(await sha256(enc.blob)))).rejects.toThrow('authentication failed');
  });

  it('rejects a wrong key', async () => {
    const enc = await encryptAttachment(bytes(10));
    const other = await encryptAttachment(bytes(10));
    await expect(decryptAttachment(enc.blob, other.key, enc.digest)).rejects.toThrow('authentication failed');
  });

  it('pads to size buckets', () => {
    expect(paddedSize(10)).toBe(541);
    expect(paddedSize(100_000)).toBeGreaterThanOrEqual(100_000);
    expect(paddedSize(100_000)).toBeLessThan(105_100);
  });
});
