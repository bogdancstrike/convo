import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import type { EnclaveApi } from '../api/enclaveApi';
import type { PreKeyDto, ReservationResponse } from '../api/types';
import { DEVICE_KEY_PROFILE, DeviceKey } from '../crypto/deviceKey';
import { NS, type SignalStore } from '../crypto/signalStore';
import { fromBase64Url, sha256, toBase64Url, utf8 } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import { RecordNs, type Repositories } from './repositories';
import type { DeviceState } from './model';

/**
 * First-device (primary) enrollment from the browser (specs §4.3, UI.md §4.1).
 *
 * Keys are generated locally and persisted as a *pending enrollment* before anything is sent, so
 * a retry after a lost response re-submits the same keys and signing key — the server then
 * returns the original result instead of creating a second device.
 */

/** Number of one-time prekeys uploaded at enrollment and on replenishment. */
export const PREKEY_BATCH = 100;
const SIGNED_PREKEY_ID = 1;
const DEVICE_KEY_NAME = 'device-signing';

interface PendingEnrollment {
  reservation: ReservationResponse;
  identityPublic: string;
  identityPrivate: string;
  registrationId: number;
  signedPreKey: { keyId: number; pub: string; priv: string; signature: string };
  preKeys: { keyId: number; pub: string; priv: string }[];
}

/**
 * Builds the canonical enrollment transcript (must match `EnrollmentTranscript` on the server).
 */
export async function enrollmentTranscript(
  r: ReservationResponse,
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

/**
 * Registers this browser as the account's first device.
 *
 * @param token Keycloak access token
 * @returns the persisted device state
 * @throws ApiError `ACCOUNT_HAS_DEVICES` when the account must link instead
 */
export async function enrollPrimary(
  api: EnclaveApi,
  token: string,
  repos: Repositories,
  signal: SignalStore,
): Promise<DeviceState> {
  const store = repos.store;
  let deviceKey = await loadDeviceKey(store);
  if (!deviceKey) {
    deviceKey = await DeviceKey.generate();
    await store.putKey(DEVICE_KEY_NAME, deviceKey.keyPair);
  }

  let pending = await store.get<PendingEnrollment>(RecordNs.pendingEnrollment, 'primary');
  if (!pending || Date.parse(pending.reservation.expiresAt) < Date.now()) {
    pending = await createPending(await api.reserve(token, 'primary'));
    await store.put(RecordNs.pendingEnrollment, 'primary', pending);
  }

  const r = pending.reservation;
  const transcript = await enrollmentTranscript(r, pending.identityPublic, pending.registrationId, deviceKey.publicKeySpki);
  const result = await api.registerPrimary(token, {
    reservationId: r.reservationId,
    identityKey: pending.identityPublic,
    registrationId: pending.registrationId,
    signedPreKey: {
      keyId: pending.signedPreKey.keyId,
      publicKey: pending.signedPreKey.pub,
      signature: pending.signedPreKey.signature,
    },
    preKeys: pending.preKeys.map<PreKeyDto>((k) => ({ keyId: k.keyId, publicKey: k.pub })),
    signingKey: deviceKey.publicKeySpki,
    signingKeyProfile: DEVICE_KEY_PROFILE,
    registrationProof: toBase64Url(await deviceKey.sign(transcript)),
    platform: 'web',
  });

  api.useDevice({ accountId: result.accountId, deviceId: result.deviceId, key: deviceKey });
  const me = await api.me();
  const state: DeviceState = {
    accountId: result.accountId,
    deviceId: result.deviceId,
    username: me.username,
    deploymentId: r.deploymentId,
    registeredAt: Date.now(),
    nextPreKeyId: PREKEY_BATCH + 1,
  };
  const ops: StoreOp[] = [
    { type: 'put', ns: NS.identity, id: 'self', value: {
      identityPublic: pending.identityPublic,
      identityPrivate: pending.identityPrivate,
      registrationId: pending.registrationId,
    } },
    { type: 'put', ns: NS.signedPreKey, id: String(pending.signedPreKey.keyId), value: { pub: pending.signedPreKey.pub, priv: pending.signedPreKey.priv } },
    ...pending.preKeys.map<StoreOp>((k) => ({ type: 'put', ns: NS.preKey, id: String(k.keyId), value: { pub: k.pub, priv: k.priv } })),
    repos.putDeviceState(state),
    { type: 'delete', ns: RecordNs.pendingEnrollment, id: 'primary' },
  ];
  await store.commit(ops);
  void signal; // protocol state is written through the same store namespaces
  return state;
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

async function createPending(reservation: ReservationResponse): Promise<PendingEnrollment> {
  const identity = await KeyHelper.generateIdentityKeyPair();
  const spk = await KeyHelper.generateSignedPreKey(identity, SIGNED_PREKEY_ID);
  const preKeys = [];
  for (let id = 1; id <= PREKEY_BATCH; id++) {
    const pk = await KeyHelper.generatePreKey(id);
    preKeys.push({ keyId: id, pub: toBase64Url(pk.keyPair.pubKey), priv: toBase64Url(pk.keyPair.privKey) });
  }
  return {
    reservation,
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
