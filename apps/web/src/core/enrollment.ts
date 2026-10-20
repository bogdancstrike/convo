import { KeyHelper, type KeyPairType } from '@privacyresearch/libsignal-protocol-typescript';
import type { EnclaveApi } from '../api/enclaveApi';
import type { PreKeyDto, RegistrationResponse, ReservationResponse, SignedPreKeyDto } from '../api/types';
import { DEVICE_KEY_PROFILE, DeviceKey } from '../crypto/deviceKey';
import { NS, type SignalStore } from '../crypto/signalStore';
import { fromBase64Url, sha256, toArrayBuffer, toBase64Url, utf8 } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import { DEFAULT_SETTINGS, type DeviceState } from './model';
import { RecordNs, type Repositories } from './repositories';

/**
 * Device enrollment from the browser (specs §4.3–4.4, UI.md §4.1–4.2): shared key generation,
 * transcript proof and atomic persistence for both first-device registration and linking.
 *
 * Keys are generated locally and persisted as a *pending enrollment* before anything is sent, so
 * a retry after a lost response re-submits the same keys and signing key — the server then
 * returns the original result instead of creating a second device.
 */

/** Number of one-time prekeys uploaded at enrollment and on replenishment. */
export const PREKEY_BATCH = 100;
const SIGNED_PREKEY_ID = 1;
const DEVICE_KEY_NAME = 'device-signing';

/** Locally generated per-install key material (private parts never leave the device). */
export interface InstallKeys {
  identityPublic: string;
  identityPrivate: string;
  registrationId: number;
  signedPreKey: { keyId: number; pub: string; priv: string; signature: string };
  preKeys: { keyId: number; pub: string; priv: string }[];
}

interface PendingEnrollment {
  reservation: ReservationResponse;
  keys: InstallKeys;
}

/** Fields needed to build an enrollment transcript. */
export type TranscriptReservation = Pick<ReservationResponse, 'reservationId' | 'accountId' | 'deviceId' | 'challenge' | 'deploymentId'>;

/**
 * Builds the canonical enrollment transcript (must match `EnrollmentTranscript` on the server).
 */
export async function enrollmentTranscript(
  r: TranscriptReservation,
  identityKey: string,
  registrationId: number,
  signingKeySpki: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyDigest = toBase64Url(await sha256(fromBase64Url(signingKeySpki)));
  return utf8(
    [
      'ENCLAVE-ENROLL-V1',
      r.deploymentId,
      `${r.accountId}.${r.deviceId}`,
      r.reservationId,
      r.challenge,
      identityKey,
      String(registrationId),
      keyDigest,
    ].join('\n'),
  );
}

/** Loads the persisted device signing key, if enrolled or enrolling. */
export async function loadDeviceKey(store: EncryptedStore): Promise<DeviceKey | undefined> {
  const pair = await store.getKey<CryptoKeyPair>(DEVICE_KEY_NAME);
  return pair ? DeviceKey.fromPair(pair) : undefined;
}

/** Loads or creates this browser's device signing key. */
export async function ensureDeviceKey(store: EncryptedStore): Promise<DeviceKey> {
  const existing = await loadDeviceKey(store);
  if (existing) return existing;
  const key = await DeviceKey.generate();
  await store.putKey(DEVICE_KEY_NAME, key.keyPair);
  return key;
}

/**
 * Generates registration ID, signed prekey and one-time prekeys under an identity key pair
 * (a fresh one for primary enrollment, the account's for linking).
 */
export async function generateInstallKeys(identity: KeyPairType): Promise<InstallKeys> {
  const spk = await KeyHelper.generateSignedPreKey(identity, SIGNED_PREKEY_ID);
  const preKeys = [];
  for (let id = 1; id <= PREKEY_BATCH; id++) {
    const pk = await KeyHelper.generatePreKey(id);
    preKeys.push({ keyId: id, pub: toBase64Url(pk.keyPair.pubKey), priv: toBase64Url(pk.keyPair.privKey) });
  }
  return {
    identityPublic: toBase64Url(identity.pubKey),
    identityPrivate: toBase64Url(identity.privKey),
    registrationId: KeyHelper.generateRegistrationId(),
    signedPreKey: {
      keyId: SIGNED_PREKEY_ID,
      pub: toBase64Url(spk.keyPair.pubKey),
      priv: toBase64Url(spk.keyPair.privKey),
      signature: toBase64Url(spk.signature),
    },
    preKeys,
  };
}

/** Public request fields shared by primary and link registration. */
export async function registrationFields(keys: InstallKeys, reservation: TranscriptReservation, deviceKey: DeviceKey) {
  const transcript = await enrollmentTranscript(reservation, keys.identityPublic, keys.registrationId, deviceKey.publicKeySpki);
  return {
    identityKey: keys.identityPublic,
    registrationId: keys.registrationId,
    signedPreKey: {
      keyId: keys.signedPreKey.keyId,
      publicKey: keys.signedPreKey.pub,
      signature: keys.signedPreKey.signature,
    } satisfies SignedPreKeyDto,
    preKeys: keys.preKeys.map<PreKeyDto>((k) => ({ keyId: k.keyId, publicKey: k.pub })),
    signingKey: deviceKey.publicKeySpki,
    signingKeyProfile: DEVICE_KEY_PROFILE,
    registrationProof: toBase64Url(await deviceKey.sign(transcript)),
    platform: 'web' as const,
  };
}

/**
 * Persists protocol identity, prekeys, device state and settings atomically after the server
 * accepted the registration.
 */
export async function persistEnrollment(
  api: EnclaveApi,
  repos: Repositories,
  keys: InstallKeys,
  deviceKey: DeviceKey,
  result: RegistrationResponse,
  deploymentId: string,
  extraOps: StoreOp[] = [],
  readReceipts = DEFAULT_SETTINGS.readReceipts,
): Promise<DeviceState> {
  api.useDevice({ accountId: result.accountId, deviceId: result.deviceId, key: deviceKey });
  const me = await api.me();
  const state: DeviceState = {
    accountId: result.accountId,
    deviceId: result.deviceId,
    username: me.username,
    displayName: me.displayName,
    deploymentId,
    registeredAt: Date.now(),
    nextPreKeyId: PREKEY_BATCH + 1,
  };
  await repos.store.commit([
    {
      type: 'put',
      ns: NS.identity,
      id: 'self',
      value: { identityPublic: keys.identityPublic, identityPrivate: keys.identityPrivate, registrationId: keys.registrationId },
    },
    { type: 'put', ns: NS.signedPreKey, id: String(keys.signedPreKey.keyId), value: { pub: keys.signedPreKey.pub, priv: keys.signedPreKey.priv } },
    ...keys.preKeys.map<StoreOp>((k) => ({ type: 'put', ns: NS.preKey, id: String(k.keyId), value: { pub: k.pub, priv: k.priv } })),
    repos.putDeviceState(state),
    repos.putSettings({ ...DEFAULT_SETTINGS, readReceipts }),
    ...extraOps,
  ]);
  return state;
}

/**
 * Registers this browser as the account's first device.
 *
 * @param token Keycloak access token
 * @returns the persisted device state
 * @throws ApiError `ACCOUNT_HAS_DEVICES` when the account must link instead
 */
export async function enrollPrimary(api: EnclaveApi, token: string, repos: Repositories): Promise<DeviceState> {
  const store = repos.store;
  const deviceKey = await ensureDeviceKey(store);
  let pending = await store.get<PendingEnrollment>(RecordNs.pendingEnrollment, 'primary');
  if (!pending || Date.parse(pending.reservation.expiresAt) < Date.now()) {
    const reservation = await api.reserve(token, 'primary');
    pending = { reservation, keys: await generateInstallKeys(await KeyHelper.generateIdentityKeyPair()) };
    await store.put(RecordNs.pendingEnrollment, 'primary', pending);
  }
  const r = pending.reservation;
  const result = await api.registerPrimary(token, { reservationId: r.reservationId, ...(await registrationFields(pending.keys, r, deviceKey)) });
  return persistEnrollment(api, repos, pending.keys, deviceKey, result, r.deploymentId, [
    { type: 'delete', ns: RecordNs.pendingEnrollment, id: 'primary' },
  ]);
}

/**
 * Generates and uploads a fresh batch of one-time prekeys (KEYS_LOW directive).
 *
 * @returns the next unused prekey ID
 */
export async function replenishPreKeys(api: EnclaveApi, signal: SignalStore, firstId: number): Promise<number> {
  const uploads: PreKeyDto[] = [];
  for (let id = firstId; id < firstId + PREKEY_BATCH; id++) {
    const pk = await KeyHelper.generatePreKey(id);
    await signal.storePreKey(id, pk.keyPair);
    uploads.push({ keyId: id, publicKey: toBase64Url(pk.keyPair.pubKey) });
  }
  await api.uploadKeys(null, uploads);
  return firstId + PREKEY_BATCH;
}

/** Converts serialized identity keys back to a library key pair. */
export function identityKeyPair(publicKey: string, privateKey: string): KeyPairType {
  return { pubKey: toArrayBuffer(fromBase64Url(publicKey)), privKey: toArrayBuffer(fromBase64Url(privateKey)) };
}
