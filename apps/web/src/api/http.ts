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
 * ENCLAVE-REQ-V1\n{METHOD}\n{path?query}\n{b64url(sha256(body))}\n{account}.{device}\n{requestId}\n{expiresMs}
 * ```
 */

/** Credentials of an enrolled device. */
export interface DeviceCredentials {
  accountId: string;
  deviceId: number;
  key: DeviceKey;
}

/** Signature lifetime; the server accepts at most 5 minutes. */
const SIGNATURE_TTL_MS = 60_000;

export class HttpClient {
  constructor(private readonly baseUrl: string = '') {}

  /** Sends a JSON request authenticated with a bearer token. */
  bearer<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    return this.send<T>(method, path, body, async () => ({ Authorization: `Bearer ${token}` }));
  }

  /** Sends a JSON request signed with the device key. */
  signed<T>(method: string, path: string, device: DeviceCredentials, body?: unknown): Promise<T> {
    return this.send<T>(method, path, body, async (bytes) => {
      const requestId = toBase64Url(randomBytes(18));
      const expires = Date.now() + SIGNATURE_TTL_MS;
      const address = `${device.accountId}.${device.deviceId}`;
      const canonical = [
        'ENCLAVE-REQ-V1',
        method,
        path,
        toBase64Url(await sha256(bytes)),
        address,
        requestId,
        String(expires),
      ].join('\n');
      const signature = await device.key.sign(utf8(canonical));
      return {
        Authorization: `EnclaveDevice ${address}`,
        'X-Enclave-Request-Id': requestId,
        'X-Enclave-Expires': String(expires),
        'X-Enclave-Signature': toBase64Url(signature),
      };
    });
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
    if (!response.ok) throw await ApiError.from(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
