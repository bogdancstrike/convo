import type { EnclaveApi } from '../api/enclaveApi';
import { openVault, sealVault, vaultKey } from '../crypto/accountVault';
import type { SignalStore } from '../crypto/signalStore';
import { fromBase64Url, randomBytes, sha256, toArrayBuffer, toBase64Url, utf8 } from '../lib/bytes';
import { ensureDeviceKey, generateInstallKeys, persistEnrollment, registrationFields, type InstallKeys } from './enrollment';
import type { Repositories } from './repositories';
import type { ReservationResponse } from '../api/types';

function secretFromCode(code: string): Uint8Array<ArrayBuffer> {
  const hex = code.replace(/[\s-]/g, '');
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('invalid recovery code');
  return Uint8Array.from(hex.match(/../g)!, (value) => parseInt(value, 16));
}
async function authorizationKey(secret: Uint8Array<ArrayBuffer>, context: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return toBase64Url(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8('CONVO-VAULT-V1'), info: utf8(`recovery-authorization/${context}`) }, material, 256));
}
const binding = (context: string) => `CONVO-RECOVERY-V1\n${context}`;

/** The code never leaves this device; authorization and encryption use distinct derived keys. */
export async function configureRecovery(api: EnclaveApi, signal: SignalStore, accountId: string, deploymentId: string): Promise<string> {
  const identity = await signal.localIdentity();
  if (!identity) throw new Error('missing identity');
  const secret = randomBytes(32);
  const code = [...secret].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join('-');
  const context = `${deploymentId}/${accountId}`;
  const key = await vaultKey(secret, `recovery-encryption/${context}`);
  const ciphertext = await sealVault(key, { v: 1, identityPublic: identity.identityPublic, identityPrivate: identity.identityPrivate }, binding(context));
  const authorizationHash = toBase64Url(await sha256(fromBase64Url(await authorizationKey(secret, context))));
  await api.saveRecovery(ciphertext, authorizationHash);
  return code;
}

/** Resume uncertain enrollment with the same persisted keys and reservation (never generate over them). */
export async function recoverAccount(api: EnclaveApi, token: string, code: string, repos: Repositories): Promise<void> {
  const backup = await api.recoveryBackup(token);
  const secret = secretFromCode(code);
  const context = `${backup.deploymentId}/${backup.accountId}`;
  const recovered = await openVault<{ v: number; identityPublic: string; identityPrivate: string }>(await vaultKey(secret, `recovery-encryption/${context}`), backup.ciphertext, binding(context));
  if (recovered.v !== 1 || fromBase64Url(recovered.identityPrivate).length !== 32 || fromBase64Url(recovered.identityPublic).length !== 33) throw new Error('invalid recovery backup');
  const authorization = await authorizationKey(secret, context);
  const deviceKey = await ensureDeviceKey(repos.store);
  let pending = await repos.store.get<{ reservation: ReservationResponse; keys: InstallKeys }>('pending-enrollment', 'recovery');
  if (!pending || pending.reservation.accountId !== backup.accountId || Date.parse(pending.reservation.expiresAt) < Date.now()) {
    const reservation = await api.reserveRecovery(token, authorization);
    pending = { reservation, keys: await generateInstallKeys({ pubKey: toArrayBuffer(fromBase64Url(recovered.identityPublic)), privKey: toArrayBuffer(fromBase64Url(recovered.identityPrivate)) }) };
    await repos.store.put('pending-enrollment', 'recovery', pending);
  }
  const result = await api.recoverDevice(token, { reservationId: pending.reservation.reservationId, ...await registrationFields(pending.keys, pending.reservation, deviceKey) }, authorization);
  await persistEnrollment(api, repos, pending.keys, deviceKey, result, backup.deploymentId, [{ type: 'delete', ns: 'pending-enrollment', id: 'recovery' }]);
}
