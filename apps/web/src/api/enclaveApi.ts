import type { DeviceCredentials, HttpClient } from './http';
import type {
  AccountDto,
  ClaimResponse,
  DeviceDto,
  PreKeyDto,
  PrimaryRegistrationRequest,
  RegistrationResponse,
  ReservationResponse,
  RosterDto,
  SelfDto,
  SendRequestDto,
  SendResultDto,
  SignedPreKeyDto,
} from './types';

/** Typed facade over the REST endpoints of specs §12. */
export class EnclaveApi {
  private device: DeviceCredentials | null = null;

  constructor(private readonly http: HttpClient) {}

  /** Sets the credentials used for device-signed calls. */
  useDevice(device: DeviceCredentials): void {
    this.device = device;
  }

  // --- enrollment (Keycloak bearer) ---------------------------------------------------------

  reserve(token: string, purpose: 'primary' | 'link'): Promise<ReservationResponse> {
    return this.http.bearer('POST', '/v1/devices/reservations', token, { purpose });
  }

  registerPrimary(token: string, request: PrimaryRegistrationRequest): Promise<RegistrationResponse> {
    return this.http.bearer('POST', '/v1/devices/primary', token, request);
  }

  // --- device-signed ------------------------------------------------------------------------

  me(): Promise<SelfDto> {
    return this.signed('GET', '/v1/accounts/me');
  }

  account(accountId: string): Promise<AccountDto> {
    return this.signed('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
  }

  roster(accountId: string): Promise<RosterDto> {
    return this.signed('GET', `/v1/accounts/${encodeURIComponent(accountId)}/devices`);
  }

  searchDirectory(query: string): Promise<AccountDto[]> {
    return this.signed('GET', `/v1/directory/search?q=${encodeURIComponent(query)}`);
  }

  claimKeys(accountId: string, deviceIds: number[] = []): Promise<ClaimResponse> {
    return this.signed('POST', `/v1/keys/${encodeURIComponent(accountId)}/claim`, { deviceIds });
  }

  uploadKeys(signedPreKey: SignedPreKeyDto | null, preKeys: PreKeyDto[]): Promise<void> {
    return this.signed('PUT', '/v1/keys', { signedPreKey, preKeys });
  }

  keyStatus(): Promise<{ oneTimePreKeys: number }> {
    return this.signed('GET', '/v1/keys/status');
  }

  devices(): Promise<DeviceDto[]> {
    return this.signed('GET', '/v1/devices');
  }

  unlinkDevice(deviceId: number): Promise<void> {
    return this.signed('DELETE', `/v1/devices/${deviceId}`);
  }

  unregisterSelf(): Promise<void> {
    return this.signed('DELETE', '/v1/devices/self');
  }

  /** REST fallback for sends; the core prefers the WebSocket. */
  send(request: SendRequestDto): Promise<SendResultDto> {
    return this.signed('PUT', `/v1/messages/${encodeURIComponent(request.destination)}`, request);
  }

  socketTicket(): Promise<{ ticket: string; expiresAt: string }> {
    return this.signed('POST', '/v1/ws/tickets');
  }

  private signed<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.device) throw new Error('device credentials not configured');
    return this.http.signed<T>(method, path, this.device, body);
  }
}
