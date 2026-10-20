import type { EnclaveApi } from '../api/enclaveApi';
import type { PendingProvisioningDto, ProvisioningOpenResponse } from '../api/types';
import {
  comparisonCode,
  generateEphemeral,
  openProvisionMessage,
  provisioningTranscript,
  sealProvisionMessage,
  type ProvisioningTranscriptInput,
} from '../crypto/provisioning';
import type { SignalStore } from '../crypto/signalStore';
import {
  ensureDeviceKey,
  generateInstallKeys,
  identityKeyPair,
  persistEnrollment,
  registrationFields,
} from './enrollment';
import type { DeviceState } from './model';
import type { Repositories } from './repositories';

/**
 * Device linking (specs §4.4, UI.md §4.2; task ID-02).
 *
 * New device: {@link LinkRequest.start} → show {@link LinkRequest.code} → {@link LinkRequest.poll}
 * until approved → {@link LinkRequest.complete}. Approving device: {@link describeRequest} →
 * user compares codes → {@link approveRequest}. The account identity key travels only inside the
 * transcript-bound E2EE channel; the new device generates every other key itself.
 */

/** Poll outcome for the new device. */
export type LinkPoll = 'waiting' | 'approved' | 'cancelled' | 'expired';

export class LinkRequest {
  private approval: { publicKey: string; message: string } | null = null;

  private constructor(
    private readonly api: EnclaveApi,
    private readonly token: string,
    private readonly session: ProvisioningOpenResponse,
    private readonly ephemeral: CryptoKeyPair,
    private readonly transcript: ProvisioningTranscriptInput,
    /** Comparison code to show to the user. */
    readonly code: string,
  ) {}

  /** Opens a provisioning session (reserves this browser's device address). */
  static async start(api: EnclaveApi, token: string, clientLabel: string): Promise<LinkRequest> {
    const ephemeral = await generateEphemeral();
    const session = await api.openProvisioning(token, ephemeral.publicKey, clientLabel);
    const transcript: ProvisioningTranscriptInput = {
      deploymentId: session.deploymentId,
      accountId: session.accountId,
      provisioningId: session.provisioningId,
      deviceId: session.deviceId,
      ephemeralPublicKey: ephemeral.publicKey,
      challenge: session.challenge,
    };
    return new LinkRequest(api, token, session, ephemeral.keyPair, transcript, await comparisonCode(provisioningTranscript(transcript)));
  }

  /** Session expiry (epoch ms). */
  get expiresAt(): number {
    return Date.parse(this.session.expiresAt);
  }

  /** Checks whether an existing device approved the request. */
  async poll(): Promise<LinkPoll> {
    if (Date.now() > this.expiresAt) return 'expired';
    const status = await this.api.provisioningStatus(this.token, this.session.provisioningId);
    if (status.status === 'cancelled') return 'cancelled';
    if (status.status === 'approved' && status.ephemeralPublicKey && status.message) {
      this.approval = { publicKey: status.ephemeralPublicKey, message: status.message };
      return 'approved';
    }
    return 'waiting';
  }

  /** Decrypts the ProvisionMessage, registers this browser and persists its state. */
  async complete(repos: Repositories): Promise<DeviceState> {
    if (!this.approval) throw new Error('not approved yet');
    const message = await openProvisionMessage(this.ephemeral.privateKey, this.approval.publicKey, this.approval.message, this.transcript);
    const keys = await generateInstallKeys(identityKeyPair(message.identityPublic, message.identityPrivate));
    const deviceKey = await ensureDeviceKey(repos.store);
    const reservation = { ...this.session };
    const result = await this.api.linkDevice(this.token, {
      provisioningId: this.session.provisioningId,
      provisioningCode: message.provisioningCode,
      ...(await registrationFields(keys, reservation, deviceKey)),
    });
    return persistEnrollment(this.api, repos, keys, deviceKey, result, this.session.deploymentId, [], message.readReceipts);
  }

  /** Abandons the request. */
  async cancel(): Promise<void> {
    await this.api.cancelProvisioning(this.token, this.session.provisioningId).catch(() => undefined);
  }
}

/** A pending request as presented on the approving device. */
export interface IncomingLinkRequest {
  provisioningId: string;
  label: string;
  code: string;
  expiresAt: number;
  transcript: ProvisioningTranscriptInput;
}

/** Computes the comparison code for a pending request listed by the server. */
export async function describeRequest(accountId: string, p: PendingProvisioningDto): Promise<IncomingLinkRequest> {
  const transcript: ProvisioningTranscriptInput = {
    deploymentId: p.deploymentId,
    accountId,
    provisioningId: p.provisioningId,
    deviceId: p.deviceId,
    ephemeralPublicKey: p.ephemeralPublicKey,
    challenge: p.challenge,
  };
  return {
    provisioningId: p.provisioningId,
    label: p.clientLabel,
    code: await comparisonCode(provisioningTranscript(transcript)),
    expiresAt: Date.parse(p.expiresAt),
    transcript,
  };
}

/**
 * Approves a request after the user confirmed matching codes: obtains the single-use code and
 * sends the account identity key to the new device over the transcript-bound channel.
 */
export async function approveRequest(
  api: EnclaveApi,
  signal: SignalStore,
  device: DeviceState,
  request: IncomingLinkRequest,
  readReceipts: boolean,
): Promise<void> {
  const identity = await signal.localIdentity();
  if (!identity) throw new Error('no local identity');
  const { code } = await api.provisioningCode(request.provisioningId);
  const sealed = await sealProvisionMessage(
    {
      v: 1,
      accountId: device.accountId,
      username: device.username,
      identityPublic: identity.identityPublic,
      identityPrivate: identity.identityPrivate,
      provisioningCode: code,
      readReceipts,
    },
    request.transcript,
  );
  await api.deliverProvisioning(request.provisioningId, sealed.ephemeralPublicKey, sealed.message);
}

/** Short human label for this browser, e.g. "Firefox on Linux" (shown on the approving device). */
export function browserLabel(userAgent: string = navigator.userAgent): string {
  const browser = /Firefox\//.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Linux/.test(userAgent)
          ? 'Linux'
          : 'unknown OS';
  return `${browser} on ${os}`;
}
