import { toBase64Url } from '../lib/bytes';

/**
 * Device proof-of-possession key (specs §4.2, profile `p256-ecdsa-sha256-v1`).
 *
 * A non-extractable ECDSA P-256 key generated with WebCrypto. Only the SPKI public key leaves the
 * browser; the private key cannot be exported by script, although same-origin code can still use
 * it while the page runs (browser trust tier).
 */
export const DEVICE_KEY_PROFILE = 'p256-ecdsa-sha256-v1';

const ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

export class DeviceKey {
  private constructor(
    private readonly pair: CryptoKeyPair,
    /** base64url SPKI public key as registered with the server. */
    readonly publicKeySpki: string,
  ) {}

  /** Generates a new non-extractable key pair. */
  static async generate(): Promise<DeviceKey> {
    const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
    return DeviceKey.fromPair(pair);
  }

  /** Wraps a stored key pair. */
  static async fromPair(pair: CryptoKeyPair): Promise<DeviceKey> {
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    return new DeviceKey(pair, toBase64Url(spki));
  }

  /** The key pair, for structured-clone persistence. */
  get keyPair(): CryptoKeyPair {
    return this.pair;
  }

  /** Signs bytes; returns an IEEE P1363 (r||s) signature, the format the server verifies. */
  async sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await crypto.subtle.sign(SIGN, this.pair.privateKey, data));
  }
}
