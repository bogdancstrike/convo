import { sha512 } from '@noble/hashes/sha2.js';
import { fromBase64Url } from '../lib/bytes';

/**
 * Public-key display fingerprint, byte-compatible with the pinned libsignal TypeScript
 * FingerprintGenerator (GPL-3.0-only, Privacy Research LLC). Its SHA-512 loop uses a timer for each
 * digest, taking tens of seconds in Firefox. Reuse the same version/encoding/5200 rounds with
 * the already-pinned Noble SHA-512 implementation. No protocol or existing safety number changes.
 */
export function safetyNumber(localId: string, localKey: string, remoteId: string, remoteKey: string): string {
  const display = (id: string, encoded: string) => {
    const key = fromBase64Url(encoded);
    if (key.length !== 33) throw new Error('invalid identity public key');
    // FingerprintGenerator.VERSION=0: two zero version bytes followed by key and account ID.
    let hash: Uint8Array = new Uint8Array(2 + key.length + id.length);
    hash.set(key, 2); hash.set(Uint8Array.from(id, (c) => c.charCodeAt(0) & 255), 2 + key.length);
    for (let i = 0; i < 5200; i++) {
      const input = new Uint8Array(hash.length + key.length); input.set(hash); input.set(key, hash.length);
      hash = sha512(input);
    }
    let result = '';
    for (let offset = 0; offset < 30; offset += 5) {
      let value = 0; for (let j = 0; j < 5; j++) value = value * 256 + hash[offset + j]!;
      result += String(value % 100000).padStart(5, '0');
    }
    return result;
  };
  return [display(localId, localKey), display(remoteId, remoteKey)].sort().join('');
}
