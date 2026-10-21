import { EnclaveApi } from '../api/enclaveApi';
import { HttpClient } from '../api/http';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { loadDeviceKey } from './enrollment';
import { Repositories } from './repositories';

/**
 * Wires the browser client together: encrypted store → repositories → Signal store → API.
 * Used by the UI at start-up and after enrollment.
 */
export interface LocalContext {
  store: EncryptedStore;
  repos: Repositories;
  signal: SignalStore;
  api: EnclaveApi;
}

/**
 * Opens local storage and creates the API facade.
 *
 * @param passphrase needed when the browser passphrase lock is on ({@link StoreLockedError} otherwise)
 */
export async function openLocalContext(passphrase?: string): Promise<LocalContext> {
  const store = await EncryptedStore.open(undefined, passphrase);
  return { store, repos: new Repositories(store), signal: new SignalStore(store), api: new EnclaveApi(new HttpClient()) };
}

/**
 * Creates the protocol client if this browser is enrolled.
 *
 * @returns the client (not yet started) or null when enrollment is required
 */
export async function createClient(context: LocalContext): Promise<EnclaveClient | null> {
  const device = await context.repos.deviceState();
  const key = await loadDeviceKey(context.store);
  if (!device || !key) return null;
  context.api.useDevice({ accountId: device.accountId, deviceId: device.deviceId, key });
  return new EnclaveClient(device, context.api, context.repos, context.signal, await context.repos.settings());
}
