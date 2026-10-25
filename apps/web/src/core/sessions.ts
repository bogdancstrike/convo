import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@privacyresearch/libsignal-protocol-typescript';
import type { EnclaveApi } from '../api/enclaveApi';
import type { DeviceMessageDto, EnvelopeDto, RosterDto } from '../api/types';
import type { SignalStore } from '../crypto/signalStore';
import { fromBase64Url, fromBinaryString, toArrayBuffer, toBase64Url } from '../lib/bytes';
import type { StoreOp } from '../storage/encryptedStore';

/**
 * Multi-device Signal fan-out and decryption (specs §5.1–5.3).
 *
 * All methods must run inside the client's protocol mutex. Encryption and decryption run in a
 * {@link SignalStore.unitOfWork} so the resulting state changes are returned as store operations
 * and committed atomically by the caller.
 */

/** Signal message type for prekey (session-establishing) messages. */
const PREKEY_WHISPER = 3;

/** Thrown when a verified peer's identity key changed; sending is blocked (UI.md §4.3). */
/**
 * Sending refused by organization policy: the account's keys or devices do not match the
 * key-transparency log (specs §19.4). Handled like an untrusted identity: the message waits.
 */
export class KeyTransparencyBlockedError extends Error {
  constructor(readonly accountId: string) {
    super('key transparency check failed');
    this.name = 'KeyTransparencyBlockedError';
  }
}

export class UntrustedIdentityError extends Error {
  constructor(readonly accountId: string) {
    super('untrusted identity');
    this.name = 'UntrustedIdentityError';
  }
}

export interface EncryptedFanout {
  messages: DeviceMessageDto[];
  ops: StoreOp[];
}

export class SessionManager {
  constructor(
    private readonly api: EnclaveApi,
    private readonly signal: SignalStore,
    private readonly self: { accountId: string; deviceId: number },
    /** Told about every roster used for encryption (key-transparency checks run after the send). */
    private readonly onRoster?: (accountId: string, roster: RosterDto) => void,
    /** Policy gate before encrypting to an account; throws {@link KeyTransparencyBlockedError}. */
    private readonly beforeEncrypt?: (accountId: string) => Promise<void>,
  ) {}

  /**
   * Encrypts padded content for every active device of `accountId` (excluding this device).
   * Missing sessions are established from claimed prekey bundles; sessions whose registration ID
   * no longer matches the roster are rebuilt.
   *
   * @returns per-device ciphertexts (empty when the account has no other devices) and state ops
   */
  async encryptForAccount(accountId: string, padded: Uint8Array<ArrayBuffer>): Promise<EncryptedFanout> {
    await this.beforeEncrypt?.(accountId);
    const roster = await this.api.roster(accountId);
    const targets = roster.devices.filter((d) => !(accountId === this.self.accountId && d.deviceId === this.self.deviceId));
    if (targets.length === 0) return { messages: [], ops: [] };

    const { result, ops } = await this.signal.unitOfWork(async () => {
      const needsSession: number[] = [];
      for (const d of targets) {
        const address = new SignalProtocolAddress(accountId, d.deviceId);
        const cipher = new SessionCipher(this.signal, address);
        const open = await cipher.hasOpenSession();
        const remoteRegistration = open ? await cipher.getRemoteRegistrationId() : undefined;
        if (!open || remoteRegistration !== d.registrationId) {
          if (open) await this.signal.removeSession(address.toString());
          needsSession.push(d.deviceId);
        }
      }
      if (needsSession.length > 0) await this.establish(accountId, needsSession);

      const messages: DeviceMessageDto[] = [];
      for (const d of targets) {
        const cipher = new SessionCipher(this.signal, new SignalProtocolAddress(accountId, d.deviceId));
        const encrypted = await cipher.encrypt(toArrayBuffer(padded));
        messages.push({
          deviceId: d.deviceId,
          registrationId: d.registrationId,
          type: encrypted.type === PREKEY_WHISPER ? 'PREKEY_MESSAGE' : 'CIPHERTEXT',
          content: toBase64Url(fromBinaryString(encrypted.body ?? '')),
        });
      }
      return messages;
    });
    this.onRoster?.(accountId, roster);
    return { messages: result, ops };
  }

  /** Drops sessions for devices the server reported as extra or stale. */
  async dropSessions(accountId: string, deviceIds: number[]): Promise<void> {
    for (const id of deviceIds) await this.signal.removeSession(new SignalProtocolAddress(accountId, id).toString());
  }

  /**
   * Decrypts an envelope.
   *
   * @returns padded plaintext and the protocol state ops to commit with the processed message
   * @throws UntrustedIdentityError if a verified sender's identity key changed
   */
  async decrypt(envelope: EnvelopeDto): Promise<{ plaintext: Uint8Array; ops: StoreOp[] }> {
    if (!envelope.sourceAccount || !envelope.sourceDevice) throw new Error('unsupported envelope');
    const sender = envelope.sourceAccount;
    const before = await this.signal.peerIdentity(sender);
    const address = new SignalProtocolAddress(sender, envelope.sourceDevice);
    const body = binaryString(fromBase64Url(envelope.content));
    const { result, ops } = await this.signal.unitOfWork(async () => {
      const cipher = new SessionCipher(this.signal, address);
      return envelope.type === 'PREKEY_MESSAGE'
        ? cipher.decryptPreKeyWhisperMessage(body, 'binary')
        : cipher.decryptWhisperMessage(body, 'binary');
    });
    // Defense in depth: never accept a silently replaced identity of a verified peer.
    const after = ops.find((o) => o.type === 'put' && o.ns === 'peer-identity' && o.id === sender);
    if (before?.verified && after && after.type === 'put' && (after.value as { identityKey: string }).identityKey !== before.identityKey) {
      throw new UntrustedIdentityError(sender);
    }
    return { plaintext: new Uint8Array(result), ops };
  }

  private async establish(accountId: string, deviceIds: number[]): Promise<void> {
    const claim = await this.api.claimKeys(accountId, deviceIds);
    const identityKey = toArrayBuffer(fromBase64Url(claim.identityKey));
    if (!(await this.signal.isTrustedIdentity(accountId, identityKey, 1))) {
      throw new UntrustedIdentityError(accountId);
    }
    for (const bundle of claim.devices) {
      const builder = new SessionBuilder(this.signal, new SignalProtocolAddress(accountId, bundle.deviceId));
      await builder.processPreKey({
        identityKey,
        registrationId: bundle.registrationId,
        signedPreKey: {
          keyId: bundle.signedPreKey.keyId,
          publicKey: toArrayBuffer(fromBase64Url(bundle.signedPreKey.publicKey)),
          signature: toArrayBuffer(fromBase64Url(bundle.signedPreKey.signature)),
        },
        preKey: bundle.preKey && {
          keyId: bundle.preKey.keyId,
          publicKey: toArrayBuffer(fromBase64Url(bundle.preKey.publicKey)),
        },
      });
    }
  }
}

function binaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}
