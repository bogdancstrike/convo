/**
 * Reversible pad-to-bucket profile for plaintext content (specs §5.5): append 0x80, then zero
 * bytes up to the next multiple of {@link BUCKET}. Ciphertext length then reveals only a coarse
 * size bucket.
 */
export const BUCKET = 160;

/** Pads plaintext to the next bucket boundary (always adds at least the terminator byte). */
export function pad(plain: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = Math.ceil((plain.length + 1) / BUCKET) * BUCKET;
  const out = new Uint8Array(size);
  out.set(plain);
  out[plain.length] = 0x80;
  return out;
}

/**
 * Removes padding.
 *
 * @throws Error if the terminator is missing (malformed or truncated input)
 */
export function unpad(padded: Uint8Array): Uint8Array {
  for (let i = padded.length - 1; i >= 0; i--) {
    const b = padded[i]!;
    if (b === 0x80) return padded.subarray(0, i);
    if (b !== 0) break;
  }
  throw new Error('invalid padding');
}
