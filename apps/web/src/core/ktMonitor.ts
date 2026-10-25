import type { EnclaveApi } from '../api/enclaveApi';
import { ApiError } from '../api/errors';
import type { RosterDto } from '../api/types';
import type { EncryptedStore } from '../storage/encryptedStore';
import { fromBase64Url } from '../lib/bytes';
import { verifyAccount, verifyConsistency, verifySignedHead, type KtSignedHead, type KtState, type KtStatus } from './keyTransparency';
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

/**
 * Proof that the log showed two incompatible histories: two heads both signed by the pinned log key
 * that cannot both be true. Kept on the device; anyone with the log key can check it.
 */
export interface KtEvidence { reason: 'split-view'; heads: KtSignedHead[]; at: number }

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
  /** Gossiped heads already compared (bounded), so receipts do not repeat proof requests. */
  private readonly compared = new Set<string>();

  constructor(
    private readonly api: EnclaveApi,
    private readonly store: EncryptedStore,
    private readonly deploymentId: string,
    /** The identity key (base64url) this device holds for an account, if any. */
    private readonly identityOf: (accountId: string) => Promise<string | undefined>,
    private readonly onChange: (accountId: string, record: KtAccountRecord) => void,
    /** A split view was detected (evidence stored): the UI should re-check and warn. */
    private readonly onSplitView: () => void = () => undefined,
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

  /** This device's newest accepted head, to gossip in receipts (undefined before the first check). */
  async gossipHead(): Promise<KtSignedHead | undefined> {
    const last = (await this.store.get<KtState>(RecordNs.kt, 'state'))?.last;
    return last?.signature && last.timestamp ? { size: last.size, root: last.root, timestamp: last.timestamp, signature: last.signature } : undefined;
  }

  /** Evidence of a split view, once found. */
  evidence(): Promise<KtEvidence | undefined> { return this.store.get<KtEvidence>(RecordNs.kt, 'evidence'); }

  /**
   * Compares a head gossiped by another person's device with this device's newest head (specs §19.4
   * split-view detection). Heads not signed by the pinned log key are ignored, so a contact cannot
   * raise false alarms; two signed heads that cannot both be true are kept as evidence.
   */
  compareGossip(peer: unknown): Promise<void> {
    const run = this.chain.then(() => this.compareNow(peer));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async compareNow(peer: unknown): Promise<void> {
    if (!isSignedHead(peer)) return;
    const key = `${peer.size}:${peer.root}`;
    if (this.compared.has(key)) return;
    if (this.compared.size > 200) this.compared.clear();
    this.compared.add(key);
    const state = await this.store.get<KtState>(RecordNs.kt, 'state');
    const mine = state?.last;
    if (!state?.logKey || !mine?.signature || mine.timestamp === undefined || await this.evidence()) return;
    if (!verifySignedHead(peer, this.deploymentId, state.logKey)) return;
    const own: KtSignedHead = { size: mine.size, root: mine.root, timestamp: mine.timestamp, signature: mine.signature };
    if (peer.size === own.size) {
      if (peer.root !== own.root) await this.splitView(peer, own);
      return;
    }
    const [older, newer] = peer.size < own.size ? [peer, own] : [own, peer];
    let proof: string[];
    try {
      proof = (await this.api.ktConsistency(older.size, newer.size)).proof;
    } catch (error) {
      // The server refuses a size someone else's device saw signed: it is hiding that head.
      if (error instanceof ApiError && error.status === 400 && newer === peer) await this.splitView(peer, own);
      return;
    }
    if (!verifyConsistency(older.size, newer.size, fromBase64Url(older.root), fromBase64Url(newer.root), proof.map(fromBase64Url))) await this.splitView(peer, own);
  }

  private async splitView(peer: KtSignedHead, own: KtSignedHead): Promise<void> {
    await this.store.put(RecordNs.kt, 'evidence', { reason: 'split-view', heads: [own, peer], at: Date.now() } satisfies KtEvidence);
    this.onSplitView();
  }

  private async checkNow(accountId: string, given: RosterDto | undefined, force: boolean): Promise<KtAccountRecord | undefined> {
    const identityKey = await this.identityOf(accountId);
    if (!identityKey) return undefined;
    const previous = await this.status(accountId);
    // Once the log was caught showing two histories, nothing it says can be trusted.
    if (await this.evidence()) {
      const record: KtAccountRecord = { status: 'log-error', reason: 'split-view', identityKey, deviceListVersion: previous?.deviceListVersion ?? 0, checkedAt: Date.now(), size: previous?.size ?? 0 };
      await this.store.put(RecordNs.ktAccounts, accountId, record);
      if (previous?.status !== 'log-error') this.onChange(accountId, record);
      return record;
    }
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

function isSignedHead(v: unknown): v is KtSignedHead {
  const h = v as KtSignedHead;
  return !!h && typeof h === 'object' && Number.isSafeInteger(h.size) && Number.isSafeInteger(h.timestamp)
    && typeof h.root === 'string' && h.root.length <= 64 && typeof h.signature === 'string' && h.signature.length <= 128;
}
