import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from '../lib/bytes';

/** Standard HKDF domain separation for account archives and recovery wrapping (ADR-0004). */
export async function vaultKey(secret: Uint8Array<ArrayBuffer>, context: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('CONVO-VAULT-V1'), info: utf8(context) },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealVault(key: CryptoKey, value: unknown, binding: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(binding) }, key, utf8(JSON.stringify(value))));
  const result = new Uint8Array(iv.length + ct.length); result.set(iv); result.set(ct, iv.length);
  return toBase64Url(result);
}

export async function openVault<T>(key: CryptoKey, sealed: string, binding: string): Promise<T> {
  const bytes = fromBase64Url(sealed);
  if (bytes.length < 29 || bytes.length > 262144) throw new Error('invalid vault entry');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(binding) }, key, bytes.slice(12));
  return JSON.parse(fromUtf8(new Uint8Array(plain))) as T;
}
