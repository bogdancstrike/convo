import type { DeviceCredentials, HttpClient } from './http';
import type {
  AccountDto,
  ClaimResponse,
  CreateGroupRequest,
  DeviceDto,
  GroupCommitRequest,
  GroupDto,
  GroupMessageRequest,
  GroupSummaryDto,
  KeyPackageClaimResponse,
  LinkRegistrationRequest,
  PendingProvisioningDto,
  ProvisioningOpenResponse,
  ProvisioningStatusResponse,
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

  history(after: number): Promise<{ seq: number; id: string; ciphertext: string }[]> {
    return this.signed('GET', `/v1/history?after=${after}`);
  }

  putHistory(id: string, ciphertext: string): Promise<void> {
    return this.signed('PUT', `/v1/history/${id}`, { ciphertext });
  }

  recoveryStatus(): Promise<{ configured: boolean }> { return this.signed('GET', '/v1/recovery/status'); }
  saveRecovery(ciphertext: string, authorizationHash: string): Promise<void> { return this.signed('PUT', '/v1/recovery', { ciphertext, authorizationHash }); }
  recoveryBackup(token: string): Promise<{ accountId: string; deploymentId: string; ciphertext: string }> { return this.http.bearer('GET', '/v1/recovery', token); }
  reserveRecovery(token: string, authorizationKey: string): Promise<ReservationResponse> { return this.http.bearer('POST', '/v1/recovery/reservations', token, { authorizationKey }); }
  recoverDevice(token: string, registration: import('./types').PrimaryRegistrationRequest, authorizationKey: string): Promise<RegistrationResponse> { return this.http.bearer('POST', '/v1/devices/recover', token, { registration, authorizationKey }); }

  // --- enrollment (Keycloak bearer) ---------------------------------------------------------

  reserve(token: string, purpose: 'primary' | 'link'): Promise<ReservationResponse> {
    return this.http.bearer('POST', '/v1/devices/reservations', token, { purpose });
  }

  registerPrimary(token: string, request: PrimaryRegistrationRequest): Promise<RegistrationResponse> {
    return this.http.bearer('POST', '/v1/devices/primary', token, request);
  }

  // --- linking: new device (Keycloak bearer) -----------------------------------------------

  openProvisioning(token: string, ephemeralPublicKey: string, clientLabel: string): Promise<ProvisioningOpenResponse> {
    return this.http.bearer('POST', '/v1/provisioning/sessions', token, { ephemeralPublicKey, clientLabel });
  }

  provisioningStatus(token: string, provisioningId: string): Promise<ProvisioningStatusResponse> {
    return this.http.bearer('GET', `/v1/provisioning/sessions/${encodeURIComponent(provisioningId)}`, token);
  }

  cancelProvisioning(token: string, provisioningId: string): Promise<void> {
    return this.http.bearer('DELETE', `/v1/provisioning/sessions/${encodeURIComponent(provisioningId)}`, token);
  }

  linkDevice(token: string, request: LinkRegistrationRequest): Promise<RegistrationResponse> {
    return this.http.bearer('POST', '/v1/devices/link', token, request);
  }

  // --- linking: approving device (device-signed) --------------------------------------------

  pendingProvisioning(): Promise<PendingProvisioningDto[]> {
    return this.signed('GET', '/v1/provisioning/sessions');
  }

  provisioningCode(provisioningId: string): Promise<{ code: string }> {
    return this.signed('POST', '/v1/devices/provisioning-code', { provisioningId });
  }

  deliverProvisioning(provisioningId: string, ephemeralPublicKey: string, message: string): Promise<void> {
    return this.signed('POST', `/v1/provisioning/sessions/${encodeURIComponent(provisioningId)}/message`, { ephemeralPublicKey, message });
  }

  declineProvisioning(provisioningId: string): Promise<void> {
    return this.signed('DELETE', `/v1/provisioning/sessions/${encodeURIComponent(provisioningId)}/approval`);
  }

  // --- device-signed ------------------------------------------------------------------------

  me(): Promise<SelfDto> {
    return this.signed('GET', '/v1/accounts/me');
  }

  account(accountId: string): Promise<AccountDto> {
    return this.signed('GET', `/v1/accounts/${encodeURIComponent(accountId)}`);
  }

  lastSeenPrivacy(): Promise<{ shareLastSeen: boolean }> { return this.signed('GET', '/v1/privacy/last-seen'); }
  setLastSeenPrivacy(shareLastSeen: boolean): Promise<void> { return this.signed('PUT', '/v1/privacy/last-seen', { shareLastSeen }); }
  lastSeenHeartbeat(): Promise<void> { return this.signed('POST', '/v1/privacy/last-seen/heartbeat'); }
  lastSeen(accountId: string): Promise<{ day: string | null; at: string | null }> { return this.signed('GET', `/v1/accounts/${encodeURIComponent(accountId)}/last-seen`); }

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

  // --- MLS KeyPackages and groups ----------------------------------------------------------

  uploadKeyPackages(keyPackages: { ref: string; keyPackage: string }[]): Promise<void> {
    return this.signed('PUT', '/v1/keypackages', { keyPackages });
  }

  keyPackageStatus(): Promise<{ oneTimePreKeys: number }> {
    return this.signed('GET', '/v1/keypackages/status');
  }

  claimKeyPackages(accountIds: string[]): Promise<KeyPackageClaimResponse> {
    return this.signed('POST', '/v1/keypackages/claim', { accountIds });
  }

  createGroup(request: CreateGroupRequest): Promise<GroupDto> {
    return this.signed('POST', '/v1/groups', request);
  }

  myGroups(): Promise<GroupSummaryDto[]> {
    return this.signed('GET', '/v1/groups/mine');
  }

  group(groupId: string): Promise<GroupDto> {
    return this.signed('GET', `/v1/groups/${groupId}`);
  }

  groupCommit(groupId: string, request: GroupCommitRequest): Promise<{ epoch: number; seq: number; duplicate: boolean }> {
    return this.signed('POST', `/v1/groups/${groupId}/commits`, request);
  }

  groupMessage(groupId: string, request: GroupMessageRequest): Promise<{ ok: boolean; duplicate: boolean }> {
    return this.signed('PUT', `/v1/groups/${groupId}/messages`, request);
  }

  /** Registers an attachment of exactly `size` encrypted bytes; returns a presigned PUT URL. */
  attachmentUploadForm(size: number): Promise<{ attachmentId: string; uploadUrl: string; expiresAt: string }> {
    return this.signed('POST', '/v1/attachments/upload-form', { size });
  }

  /** Presigned GET URL for an attachment. */
  attachmentDownload(attachmentId: string): Promise<{ downloadUrl: string; expiresAt: string }> {
    return this.signed('GET', `/v1/attachments/${encodeURIComponent(attachmentId)}`);
  }

  socketTicket(): Promise<{ ticket: string; expiresAt: string }> {
    return this.signed('POST', '/v1/ws/tickets');
  }

  private signed<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.device) throw new Error('device credentials not configured');
    return this.http.signed<T>(method, path, this.device, body);
  }
}
