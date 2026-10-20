/**
 * Wire types of the Enclave REST/WebSocket API v1. Binary fields are unpadded base64url strings.
 * Server counterparts: `IdentityDtos`, `WireFormat`, `MessageController`.
 */

export interface ReservationResponse {
  reservationId: string;
  accountId: string;
  deviceId: number;
  challenge: string;
  deploymentId: string;
  expiresAt: string;
}

export interface SignedPreKeyDto {
  keyId: number;
  publicKey: string;
  signature: string;
}

export interface PreKeyDto {
  keyId: number;
  publicKey: string;
}

export interface PrimaryRegistrationRequest {
  reservationId: string;
  identityKey: string;
  registrationId: number;
  signedPreKey: SignedPreKeyDto;
  preKeys: PreKeyDto[];
  signingKey: string;
  signingKeyProfile: string;
  registrationProof: string;
  platform: 'web';
  nameEnc?: string;
}

export interface RegistrationResponse {
  accountId: string;
  deviceId: number;
  deviceListVersion: number;
}

export interface SelfDto {
  accountId: string;
  username: string;
  deviceId: number;
  identityKey: string;
  deviceListVersion: number;
}

export interface AccountDto {
  accountId: string;
  username: string;
  identityKey?: string;
}

export interface RosterDto {
  accountId: string;
  deviceListVersion: number;
  devices: { deviceId: number; registrationId: number }[];
}

export interface BundleDto {
  deviceId: number;
  registrationId: number;
  signedPreKey: SignedPreKeyDto;
  preKey?: PreKeyDto;
}

export interface ClaimResponse {
  accountId: string;
  identityKey: string;
  deviceListVersion: number;
  devices: BundleDto[];
}

export interface DeviceDto {
  deviceId: number;
  platform: string;
  nameEnc?: string;
  createdAt: string;
  lastSeenDay?: string;
  current: boolean;
}

export type EnvelopeType = 'CIPHERTEXT' | 'PREKEY_MESSAGE';

export interface DeviceMessageDto {
  deviceId: number;
  registrationId: number;
  type: EnvelopeType;
  content: string;
}

export interface SendRequestDto {
  destination: string;
  submissionId: string;
  messages: DeviceMessageDto[];
  urgent: boolean;
  transientTtlSeconds: number;
}

export interface SendResultDto {
  ok: boolean;
  duplicate?: boolean;
  errorCode?: string;
  missingDevices?: number[];
  extraDevices?: number[];
  staleDevices?: number[];
}

export interface EnvelopeDto {
  guid: string;
  type: 'CIPHERTEXT' | 'PREKEY_MESSAGE' | 'MLS_PRIVATE' | 'MLS_COMMIT' | 'MLS_WELCOME' | 'MLS_PROPOSAL' | string;
  groupId?: string;
  epoch?: number;
  groupSeq?: number;
  sourceAccount?: string;
  sourceDevice?: number;
  serverTimestamp: number;
  expiresAt: number;
  urgent: boolean;
  content: string;
}

export type Directive = 'KEYS_LOW' | 'KEYPACKAGES_LOW' | 'DEVICE_LIST_CHANGED' | 'POLICY_UPDATED' | 'REVOKED';

export interface ServerFrame {
  requestId: number;
  envelope?: EnvelopeDto;
  sendResult?: SendResultDto;
  queueEmpty?: Record<string, never>;
  directive?: { type: Directive };
  pong?: Record<string, never>;
  error?: { code: string; detail: string };
}

export interface ProvisioningOpenResponse {
  provisioningId: string;
  reservationId: string;
  accountId: string;
  deviceId: number;
  challenge: string;
  deploymentId: string;
  expiresAt: string;
}

export interface ProvisioningStatusResponse {
  status: 'pending' | 'approved' | 'completed' | 'cancelled';
  ephemeralPublicKey?: string;
  message?: string;
}

export interface PendingProvisioningDto {
  provisioningId: string;
  deviceId: number;
  ephemeralPublicKey: string;
  clientLabel: string;
  challenge: string;
  deploymentId: string;
  createdAt: string;
  expiresAt: string;
}

export interface LinkRegistrationRequest extends Omit<PrimaryRegistrationRequest, 'reservationId'> {
  provisioningId: string;
  provisioningCode: string;
}

export interface KeyPackageClaimResponse {
  keyPackages: { accountId: string; deviceId: number; keyPackage: string }[];
  unavailable: { accountId: string; deviceId: number }[];
}

export type GroupRole = 'owner' | 'admin' | 'member';

export interface DeviceRef {
  accountId: string;
  deviceId: number;
}

export interface GroupDto {
  groupId: string;
  epoch: number;
  members: { accountId: string; role: GroupRole }[];
  devices: DeviceRef[];
}

export interface GroupSummaryDto {
  groupId: string;
  epoch: number;
  role: GroupRole;
  members: number;
}

export interface CreateGroupRequest {
  groupId: string;
  epoch: number;
  members: string[];
  devices: DeviceRef[];
  welcome?: string;
}

export interface GroupCommitRequest {
  epoch: number;
  submissionId: string;
  commit: string;
  welcome?: string;
  addMembers?: string[];
  removeMembers?: string[];
  addDevices?: DeviceRef[];
  removeDevices?: DeviceRef[];
  roleChanges?: Record<string, GroupRole>;
}

export interface GroupMessageRequest {
  epoch: number;
  submissionId: string;
  message: string;
}
