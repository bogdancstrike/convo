import type { EnclaveApi } from '../api/enclaveApi';
import { ApiError } from '../api/errors';
import type { RosterDto } from '../api/types';
import type { EncryptedStore } from '../storage/encryptedStore';
import { verifyAccount, type KtState, type KtStatus } from './keyTransparency';
import { RecordNs } from './repositories';

/** The last key-transparency result for one account (device-local). */
export interface KtAccountRecord {
  status: KtStatus;
  reason?: string;
  identityKey: string;
  deviceListVersion: number;
  checkedAt: number;
  /** Log size the result refers to. */
  size: number;
}

/** A good result is reused for this long while the keys and roster stay the same. */
const VERIFIED_FOR_MS = 6 * 3600_000;
/** Unwitnessed or stale results are retried sooner (a co-signature may have arrived). */
const RETRY_AFTER_MS = 10 * 60_000;

/**
 * Checks the keys this device encrypts to against the key-transparency log (core/keyTransparency.ts)
 * and remembers the outcome per account. Checks are serialized so the pinned log state only moves
 * forward. Network or "log not set up" failures leave the previous result in place; they are not
 * evidence of an attack. Policy today is "warn": results are shown, sending is not blocked.
 */
export class KeyTransparencyMonitor {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: EnclaveApi,
    private readonly store: EncryptedStore,
    private readonly deploymentId: string,
    /** The identity key (base64url) this device holds for an account, if any. */
    private readonly identityOf: (accountId: string) => Promise<string | undefined>,
    private readonly onChange: (accountId: string, record: KtAccountRecord) => void,
  ) {}

  /** The stored result for an account. */
  status(accountId: string): Promise<KtAccountRecord | undefined> {
    return this.store.get<KtAccountRecord>(RecordNs.ktAccounts, accountId);
  }

  /**
   * Verifies an account's identity key and roster. Reuses a recent good result for the same keys
   * unless `force` is set (opening a contact's info).
   */
  check(accountId: string, roster?: RosterDto, force = false): Promise<KtAccountRecord | undefined> {
    const run = this.chain.then(() => this.checkNow(accountId, roster, force));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async checkNow(accountId: string, given: RosterDto | undefined, force: boolean): Promise<KtAccountRecord | undefined> {
    const identityKey = await this.identityOf(accountId);
    if (!identityKey) return undefined;
    const previous = await this.status(accountId);
    let roster = given;
    const fresh = (r: RosterDto) => previous && previous.identityKey === identityKey && previous.deviceListVersion === r.deviceListVersion
      && Date.now() - previous.checkedAt < (previous.status === 'verified' ? VERIFIED_FOR_MS : RETRY_AFTER_MS);
    if (!force && roster && fresh(roster)) return previous;
    try {
      roster ??= await this.api.roster(accountId);
      const state = (await this.store.get<KtState>(RecordNs.kt, 'state')) ?? {};
      let result;
      try {
        const proof = await this.api.ktAccount(accountId, state.last?.size ?? 0);
        result = verifyAccount(proof, { accountId, identityKey, roster }, this.deploymentId, state, Date.now());
      } catch (error) {
        // The server refusing a size this device already saw is a rollback.
        if (error instanceof ApiError && error.status === 409) result = { status: 'log-error' as const, reason: 'rollback', state, size: state.last?.size ?? 0 };
        else return previous; // offline, or the log is not set up on this server
      }
      if (result.status !== 'log-error') await this.store.put(RecordNs.kt, 'state', result.state);
      const record: KtAccountRecord = { status: result.status, reason: result.reason, identityKey, deviceListVersion: roster.deviceListVersion, checkedAt: Date.now(), size: result.size };
      await this.store.put(RecordNs.ktAccounts, accountId, record);
      if (previous?.status !== record.status || previous.identityKey !== identityKey) this.onChange(accountId, record);
      return record;
    } catch {
      return previous;
    }
  }
}

/**
 * Policy gate before encrypting to an account: with blocking on, an account whose last result was a
 * mismatch or log error is checked again and refused only if it still fails (the problem may be over).
 */
export async function mustBlock(monitor: Pick<KeyTransparencyMonitor, 'status' | 'check'>, accountId: string, blocking: boolean): Promise<boolean> {
  if (!blocking) return false;
  const bad = (s?: KtStatus) => s === 'mismatch' || s === 'log-error';
  if (!bad((await monitor.status(accountId))?.status)) return false;
  return bad((await monitor.check(accountId, undefined, true))?.status);
}
