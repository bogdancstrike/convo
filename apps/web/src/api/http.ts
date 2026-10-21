import { randomBytes, sha256, toBase64Url, utf8 } from '../lib/bytes';
import type { DeviceKey } from '../crypto/deviceKey';
import { ApiError, NetworkError } from './errors';

/**
 * HTTP transport with the two authentication modes of specs §12:
 *
 * - **Bearer** (`K`): Keycloak access token, only for enrollment.
 * - **Device** (`D`): every other call is signed with the device proof-of-possession key using the
 *   canonical string below (must match `SignedDeviceRequest` on the server).
 *
 * ```
 * ENCLAVE-REQ-V2\n{METHOD}\n{path?query}\n{b64url(sha256(body))}\n{account}.{device}\n{requestId}\n{nonce}\n{expiresMs}
 * ```
 *
 * `nonce` is single-use and server-issued (PRIV-02): each authenticated response carries the next
 * one (`X-Enclave-Next-Nonce`); an empty pool is refilled from `POST /v1/device-nonces`. A
 * rejected nonce (`NONCE_INVALID`, nothing was processed) is retried once with fresh nonces.
 */

/** Credentials of an enrolled device. */
export interface DeviceCredentials {
  accountId: string;
  deviceId: number;
  key: DeviceKey;
}

/**
 * Builds the canonical signed string of a device request: `ENCLAVE-REQ-V2` with a server nonce,
 * or the legacy `ENCLAVE-REQ-V1` without. Covered by the shared vectors
 * `contracts/vectors/device-auth-v1.json` and `device-auth-v2.json`.
 */
export async function canonicalRequest(
  method: string,
  pathAndQuery: string,
  body: Uint8Array<ArrayBuffer>,
  deviceAddress: string,
  requestId: string,
  expiresAtMillis: number,
  nonce?: string,
): Promise<string> {
  const digest = toBase64Url(await sha256(body));
  return (nonce === undefined
    ? ['ENCLAVE-REQ-V1', method, pathAndQuery, digest, deviceAddress, requestId, String(expiresAtMillis)]
    : ['ENCLAVE-REQ-V2', method, pathAndQuery, digest, deviceAddress, requestId, nonce, String(expiresAtMillis)]).join('\n');
}

/** Issued nonces live 2 minutes on the server; use them well before that. */
const NONCE_MAX_AGE_MS = 90_000;

/** Signature lifetime; the server accepts at most 5 minutes. */
const SIGNATURE_TTL_MS = 60_000;

export class HttpClient {
  /** Unused server nonces for the enrolled device (newest last). */
  private nonces: { value: string; at: number }[] = [];
  private refilling: Promise<void> | null = null;

  constructor(private readonly baseUrl: string = '') {}

  private async takeNonce(address: string): Promise<string> {
    const now = Date.now();
    this.nonces = this.nonces.filter((n) => now - n.at < NONCE_MAX_AGE_MS);
    if (this.nonces.length === 0) {
      // One refill at a time; concurrent requests share it.
      this.refilling ??= this.send<{ nonces: string[] }>('POST', '/v1/device-nonces', { device: address }, async () => ({}))
        .then((r) => { this.nonces.push(...r.nonces.map((value) => ({ value, at: Date.now() }))); })
        .finally(() => { this.refilling = null; });
      await this.refilling;
    }
    const next = this.nonces.pop();
    if (!next) throw new ApiError(401, 'NONCE_INVALID', 'no device nonce available');
    return next.value;
  }

  /** Sends a JSON request authenticated with a bearer token. */
  bearer<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    return this.send<T>(method, path, body, async () => ({ Authorization: `Bearer ${token}` }));
  }

  /** Sends a JSON request signed with the device key (profile V2, single-use server nonce). */
  async signed<T>(method: string, path: string, device: DeviceCredentials, body?: unknown): Promise<T> {
    const address = `${device.accountId}.${device.deviceId}`;
    const attempt = () => this.send<T>(method, path, body, async (bytes) => {
      const requestId = toBase64Url(randomBytes(18));
      const expires = Date.now() + SIGNATURE_TTL_MS;
      const nonce = await this.takeNonce(address);
      const canonical = await canonicalRequest(method, path, bytes, address, requestId, expires, nonce);
      const signature = await device.key.sign(utf8(canonical));
      return {
        Authorization: `EnclaveDevice ${address}`,
        'X-Enclave-Request-Id': requestId,
        'X-Enclave-Nonce': nonce,
        'X-Enclave-Expires': String(expires),
        'X-Enclave-Signature': toBase64Url(signature),
      };
    });
    try {
      return await attempt();
    } catch (error) {
      // The server rejected the proof before processing anything: drop stale nonces, retry once.
      if (!(error instanceof ApiError) || error.code !== 'NONCE_INVALID') throw error;
      this.nonces = [];
      return attempt();
    }
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    authHeaders: (body: Uint8Array<ArrayBuffer>) => Promise<Record<string, string>>,
  ): Promise<T> {
    const bytes = body === undefined ? new Uint8Array(0) : utf8(JSON.stringify(body));
    const headers: Record<string, string> = { Accept: 'application/json', ...(await authHeaders(bytes)) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : bytes,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      throw new NetworkError(error);
    }
    const next = response.headers.get('X-Enclave-Next-Nonce');
    if (next && /^[A-Za-z0-9_-]{32}$/.test(next)) this.nonces.push({ value: next, at: Date.now() });
    if (!response.ok) throw await ApiError.from(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
