import type { SignedPolicy } from '../core/policy';
import type { CallJoin } from '../core/calls';
import type { DeviceCredentials, HttpClient } from './http';
import type {
  AccountDto,
  CommunityDto,
  CommunityLinkDto,
  CredentialStatusDto,
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
  /** Authorizes a direct (peer) or group call and returns a LiveKit join token for this device. */
  /** Accounts allowed to receive abuse reports (organization security contacts). */
  reportRecipients(): Promise<{ accountId: string; displayName: string }[]> { return this.signed('GET', '/v1/reports/recipients'); }
  /** Publishes this device's MLS signature key with its identity-key binding (GRP-01). */
  publishMlsBinding(signatureKey: string, binding: string): Promise<void> { return this.signed('PUT', '/v1/devices/self/mls-binding', { signatureKey, binding }); }
  /** Bindings of an account's active devices. */
  mlsBindings(accountId: string): Promise<{ deviceId: number; signatureKey: string; binding: string }[]> { return this.signed('GET', `/v1/accounts/${encodeURIComponent(accountId)}/mls-bindings`); }
  /** The current signed organization policy; undefined (204) when none was published. */
  policy(): Promise<SignedPolicy | undefined> { return this.signed('GET', '/v1/policy'); }
  createCall(request: { peer?: string; groupId?: string; video: boolean }): Promise<CallJoin> { return this.signed('POST', '/v1/calls', request); }
  joinCall(callId: string): Promise<CallJoin> { return this.signed('POST', `/v1/calls/${encodeURIComponent(callId)}/join`); }
  createCallLink(groupId: string, ttlMinutes?: number): Promise<{ token: string; expiresAt: string }> { return this.signed('POST', '/v1/calls/links', { groupId, ttlMinutes }); }
  resolveCallLink(token: string): Promise<{ groupId: string; callId: string | null; video: boolean | null; expiresAt: string }> { return this.signed('POST', `/v1/calls/links/${encodeURIComponent(token)}/resolve`); }
  revokeCallLink(token: string): Promise<void> { return this.signed('DELETE', `/v1/calls/links/${encodeURIComponent(token)}`); }
  endCall(callId: string): Promise<void> { return this.signed('POST', `/v1/calls/${encodeURIComponent(callId)}/end`); }
  /** Own sign-in credential types at the IdP (passkey/OTP) for lock gating; `unavailable` on IdP errors. */
  accountCredentials(refresh = false): Promise<CredentialStatusDto> { return this.signed('GET', `/v1/account/credentials${refresh ? '?refresh=true' : ''}`); }
  // --- communities (COM-01) ---
  createCommunity(rootGroupId: string): Promise<CommunityDto> { return this.signed('POST', '/v1/communities', { rootGroupId }); }
  myCommunities(): Promise<CommunityDto[]> { return this.signed('GET', '/v1/communities/mine'); }
  communityGroups(communityId: string): Promise<CommunityLinkDto[]> { return this.signed('GET', `/v1/communities/${encodeURIComponent(communityId)}/groups`); }
  linkCommunityGroup(communityId: string, groupId: string, visibility: 'discoverable' | 'private', delegation = false): Promise<CommunityLinkDto> {
    return this.signed('POST', `/v1/communities/${encodeURIComponent(communityId)}/links`, { groupId, visibility, delegation });
  }
  acceptCommunityLink(communityId: string, groupId: string, delegation = false): Promise<void> {
    return this.signed('POST', `/v1/communities/${encodeURIComponent(communityId)}/links/${encodeURIComponent(groupId)}/accept`, { delegation });
  }
  communityOperations(communityId: string): Promise<{ groupId: string; accountId: string; status: 'pending' | 'completed' | 'blocked'; updatedAt: string }[]> {
    return this.signed('GET', `/v1/communities/${encodeURIComponent(communityId)}/operations`);
  }
  /** Community admins: retry removals blocked by a subgroup's last owner. */
  retryCommunityOperations(communityId: string): Promise<{ unblocked: number }> {
    return this.signed('POST', `/v1/communities/${encodeURIComponent(communityId)}/operations/retry`, {});
  }
  unlinkCommunityGroup(communityId: string, groupId: string): Promise<void> {
    return this.signed('DELETE', `/v1/communities/${encodeURIComponent(communityId)}/links/${encodeURIComponent(groupId)}`);
  }
  requestCommunityGroup(communityId: string, groupId: string): Promise<void> {
    return this.signed('POST', `/v1/communities/${encodeURIComponent(communityId)}/groups/${encodeURIComponent(groupId)}/join`);
  }

  /** UnifiedPush endpoint for content-free wake-ups (Android; MSG-02). */
  setPushEndpoint(endpoint: string): Promise<void> { return this.signed('PUT', '/v1/push/endpoint', { endpoint }); }
  clearPushEndpoint(): Promise<void> { return this.signed('DELETE', '/v1/push/endpoint'); }
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

  createInvite(groupId: string): Promise<{ token: string; expiresAt: string }> { return this.signed('POST', `/v1/groups/${encodeURIComponent(groupId)}/invites`); }
  revokeInvites(groupId: string): Promise<void> { return this.signed('DELETE', `/v1/groups/${encodeURIComponent(groupId)}/invites`); }
  banMember(groupId: string, accountId: string): Promise<void> { return this.signed('PUT', `/v1/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(accountId)}`); }
  unbanMember(groupId: string, accountId: string): Promise<void> { return this.signed('DELETE', `/v1/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(accountId)}`); }
  groupBans(groupId: string): Promise<string[]> { return this.signed('GET', `/v1/groups/${encodeURIComponent(groupId)}/bans`); }
  requestToJoin(token: string): Promise<void> { return this.signed('POST', `/v1/invites/${encodeURIComponent(token)}/requests`); }
  joinRequests(groupId: string): Promise<{ accountId: string; requestedAt: string }[]> { return this.signed('GET', `/v1/groups/${encodeURIComponent(groupId)}/join-requests`); }
  declineJoin(groupId: string, accountId: string): Promise<void> { return this.signed('DELETE', `/v1/groups/${encodeURIComponent(groupId)}/join-requests/${encodeURIComponent(accountId)}`); }
  /** Leaves a group (the server stops fan-out at once; members complete the MLS removal). */
  leaveGroup(groupId: string): Promise<void> { return this.signed('POST', `/v1/groups/${encodeURIComponent(groupId)}/leave`); }
  /** Accepted commits of a group from an epoch on (catch-up after missed commits; ≤ 100 per page). */
  groupEvents(groupId: string, fromEpoch: number): Promise<{ seq: number; epoch: number; commit: string }[]> {
    return this.signed('GET', `/v1/groups/${groupId}/events?fromEpoch=${fromEpoch}`);
  }
  /** Whether a commit whose response was lost was accepted (404 ApiError when it was not). */
  groupCommitStatus(groupId: string, submissionId: string): Promise<{ epoch: number; seq: number; duplicate: boolean }> {
    return this.signed('GET', `/v1/groups/${groupId}/commits/${submissionId}`);
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
  /** Resumable upload (FEAT-01): the secret is required for every later step. */
  attachmentMultipart(size: number): Promise<{ attachmentId: string; uploadSecret: string; partSize: number; partCount: number; expiresAt: string }> {
    return this.signed('POST', '/v1/attachments/multipart', { size });
  }
  attachmentParts(attachmentId: string, uploadSecret: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]> {
    return this.signed('POST', `/v1/attachments/${encodeURIComponent(attachmentId)}/multipart/parts`, { uploadSecret, partNumbers });
  }
  attachmentUploadedParts(attachmentId: string, uploadSecret: string): Promise<{ uploadedParts: number[] }> {
    return this.signed('POST', `/v1/attachments/${encodeURIComponent(attachmentId)}/multipart/status`, { uploadSecret });
  }
  attachmentComplete(attachmentId: string, uploadSecret: string): Promise<void> {
    return this.signed('POST', `/v1/attachments/${encodeURIComponent(attachmentId)}/multipart/complete`, { uploadSecret });
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
