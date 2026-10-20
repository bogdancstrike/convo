import {
  Direction,
  type KeyPairType,
  type SessionRecordType,
  type StorageType,
} from '@privacyresearch/libsignal-protocol-typescript';
import { bytesEqual, fromBase64Url, toArrayBuffer, toBase64Url } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';

/**
 * Signal protocol state on top of {@link EncryptedStore}, with a unit-of-work overlay.
 *
 * Writes made by the Signal library during {@link SignalStore.unitOfWork} are buffered and
 * returned as {@link StoreOp}s, so the caller commits them in the same IndexedDB transaction as
 * the decrypted message and processed marker (specs §8 "decrypt → persist → ack", §24.3).
 * Callers must serialize units of work (see `lib/mutex.ts`).
 */

/** Namespaces used in the encrypted store. */
export const NS = {
  identity: 'identity',
  peerIdentity: 'peer-identity',
  preKey: 'prekey',
  signedPreKey: 'signed-prekey',
  session: 'session',
} as const;

/** The account identity key pair and this install's registration ID. */
export interface LocalIdentity {
  identityPublic: string;
  identityPrivate: string;
  registrationId: number;
}

/** Trust state of a peer account's identity key (specs §4.3, §5.6). */
export interface PeerIdentity {
  accountId: string;
  identityKey: string;
  /** Set when the user compared safety numbers out of band. */
  verified: boolean;
  firstSeen: number;
  /** Timestamp of the last identity change, for the "security identity changed" notice. */
  changedAt?: number;
}

interface SerializedKeyPair {
  pub: string;
  priv: string;
}

type Overlay = Map<string, { ns: string; id: string; value: unknown | undefined }>;

export class SignalStore implements StorageType {
  private overlay: Overlay | null = null;

  constructor(private readonly store: EncryptedStore) {}

  /**
   * Runs `work` with buffered writes and returns its result plus the pending operations. If
   * `work` throws, buffered writes are discarded (protocol state is not advanced).
   */
  async unitOfWork<T>(work: () => Promise<T>): Promise<{ result: T; ops: StoreOp[] }> {
    if (this.overlay) throw new Error('nested unit of work');
    this.overlay = new Map();
    try {
      const result = await work();
      const ops: StoreOp[] = [...this.overlay.values()].map((e) =>
        e.value === undefined ? { type: 'delete', ns: e.ns, id: e.id } : { type: 'put', ns: e.ns, id: e.id, value: e.value },
      );
      return { result, ops };
    } finally {
      this.overlay = null;
    }
  }

  // --- local identity ---------------------------------------------------------------------

  /** Persists the local identity (outside any unit of work). */
  async saveLocalIdentity(identity: LocalIdentity): Promise<void> {
    await this.store.put(NS.identity, 'self', identity);
  }

  async localIdentity(): Promise<LocalIdentity | undefined> {
    return this.read<LocalIdentity>(NS.identity, 'self');
  }

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const id = await this.localIdentity();
    return id && { pubKey: toArrayBuffer(fromBase64Url(id.identityPublic)), privKey: toArrayBuffer(fromBase64Url(id.identityPrivate)) };
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return (await this.localIdentity())?.registrationId;
  }

  // --- peer identities --------------------------------------------------------------------

  async peerIdentity(accountId: string): Promise<PeerIdentity | undefined> {
    return this.read<PeerIdentity>(NS.peerIdentity, accountId);
  }

  /** Marks a peer verified/unverified (safety-number comparison). */
  async setVerified(accountId: string, verified: boolean): Promise<void> {
    const current = await this.peerIdentity(accountId);
    if (current) await this.store.put(NS.peerIdentity, accountId, { ...current, verified, changedAt: undefined });
  }

  /**
   * Trust-on-first-use with change detection. A changed key of a **verified** peer is not trusted
   * (sending is blocked until re-verification, UI.md §4.3); for unverified peers the change is
   * accepted and surfaced as a notice via `changedAt`.
   */
  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, _direction: Direction): Promise<boolean> {
    const known = await this.peerIdentity(accountOf(identifier));
    if (!known) return true;
    if (bytesEqual(fromBase64Url(known.identityKey), new Uint8Array(identityKey))) return true;
    return !known.verified;
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const accountId = accountOf(encodedAddress);
    const key = toBase64Url(publicKey);
    const known = await this.peerIdentity(accountId);
    if (known?.identityKey === key) return false;
    const now = Date.now();
    const next: PeerIdentity = known
      ? { ...known, identityKey: key, verified: false, changedAt: now }
      : { accountId, identityKey: key, verified: false, firstSeen: now };
    this.write(NS.peerIdentity, accountId, next);
    if (!this.overlay) await this.store.put(NS.peerIdentity, accountId, next);
    return known !== undefined;
  }

  // --- prekeys ------------------------------------------------------------------------------

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return deserializePair(await this.read<SerializedKeyPair>(NS.preKey, String(keyId)));
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.writeThrough(NS.preKey, String(keyId), serializePair(keyPair));
  }

  async removePreKey(keyId: string | number): Promise<void> {
    await this.writeThrough(NS.preKey, String(keyId), undefined);
  }

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return deserializePair(await this.read<SerializedKeyPair>(NS.signedPreKey, String(keyId)));
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.writeThrough(NS.signedPreKey, String(keyId), serializePair(keyPair));
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    await this.writeThrough(NS.signedPreKey, String(keyId), undefined);
  }

  // --- sessions -----------------------------------------------------------------------------

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    return this.read<string>(NS.session, encodedAddress);
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    await this.writeThrough(NS.session, encodedAddress, record);
  }

  /** Deletes a session (device removed or re-registered). */
  async removeSession(encodedAddress: string): Promise<void> {
    await this.writeThrough(NS.session, encodedAddress, undefined);
  }

  // --- internals ----------------------------------------------------------------------------

  private async read<T>(ns: string, id: string): Promise<T | undefined> {
    const pending = this.overlay?.get(`${ns}\u0000${id}`);
    if (pending) return pending.value as T | undefined;
    return this.store.get<T>(ns, id);
  }

  private write(ns: string, id: string, value: unknown | undefined): void {
    this.overlay?.set(`${ns}\u0000${id}`, { ns, id, value });
  }

  /** Buffers inside a unit of work; otherwise writes immediately. */
  private async writeThrough(ns: string, id: string, value: unknown | undefined): Promise<void> {
    if (this.overlay) {
      this.write(ns, id, value);
    } else if (value === undefined) {
      await this.store.delete(ns, id);
    } else {
      await this.store.put(ns, id, value);
    }
  }
}

/** Signal addresses are `accountId.deviceId`; identities are per account (shared IK, specs §3.3). */
function accountOf(identifier: string): string {
  const dot = identifier.lastIndexOf('.');
  return dot > 0 && /^\d+$/.test(identifier.slice(dot + 1)) ? identifier.slice(0, dot) : identifier;
}

function serializePair(pair: KeyPairType): SerializedKeyPair {
  return { pub: toBase64Url(pair.pubKey), priv: toBase64Url(pair.privKey) };
}

function deserializePair(pair: SerializedKeyPair | undefined): KeyPairType | undefined {
  return pair && { pubKey: toArrayBuffer(fromBase64Url(pair.pub)), privKey: toArrayBuffer(fromBase64Url(pair.priv)) };
}
