import type { BindingVerdict } from '../crypto/mlsBinding';
import { ApiError, NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import type { CreateGroupRequest, DeviceRef, EnvelopeDto, GroupRole } from '../api/types';
import {
  addProposals,
  commit,
  createGroupWith,
  decodeKeyPackageMessage,
  decrypt,
  deserializeState,
  encrypt,
  epochOf,
  generateKeyPackages,
  generateSigner,
  join,
  keyPackageIdentity,
  members,
  processCommit,
  removeProposals,
  serializeState,
  welcomeTargets,
  type CommitOutput,
  type GeneratedKeyPackage,
  type MlsSigner, keyPackageSignatureKey, memberKeys } from '../crypto/mls';
import { fromBase64Url, randomBytes, toBase64Url } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import type { ClientState } from 'ts-mls';

/**
 * Client side of MLS groups (specs §6; tasks GRP-02/03). Owns MLS signer, KeyPackages and group
 * states; talks to the Delivery Service; returns {@link StoreOp}s so the caller commits state
 * changes atomically with message processing. All methods must run inside the protocol mutex.
 */

export const GroupNs = {
  signer: 'mls-signer',
  keyPackage: 'mls-kp',
  state: 'mls-state',
  group: 'group',
  /** A commit sent but with an unknown outcome (lost response): resolved before further group work. */
  pendingCommit: 'mls-pending-commit',
} as const;

/** A commit whose acceptance is unknown; `state` is the epoch it produces if it was accepted. */
interface PendingCommit { groupId: string; submissionId: string; state: string }

/** Network retries of the same commit submission before its outcome is left for later resolution. */
const COMMIT_RETRIES = 2;

/** Keep at least this many KeyPackages on the server; upload {@link KEY_PACKAGE_BATCH} when below. */
const KEY_PACKAGE_MIN = 10;
const KEY_PACKAGE_BATCH = 20;

/** Locally known group facts (name and roles come from E2EE metadata and the DS ACL mirror). */
export interface GroupRecord {
  adminOnly?: boolean;
  needsJoin?: boolean;
  groupId: string;
  name: string;
  /** Monotonic metadata version (highest wins). */
  metaVersion: number;
  members: { accountId: string; role: GroupRole }[];
  /** Members who left and await removal of their MLS leaves. */
  departed?: string[];
  /** This device was removed or left. */
  left: boolean;
  /** About text (E2EE metadata from owners/admins). */
  description?: string;
  /** Community root metadata (E2EE, from root owners/admins). */
  community?: import('../crypto/content').CommunityMeta;
  /**
   * Device addresses in the MLS tree whose signature key is not bound to their account (GRP-01):
   * someone (e.g. the server) put a device in the group that its account never vouched for. Sending
   * is refused while any are present.
   */
  untrustedDevices?: string[];
}

/** Checks MLS signature keys against published device bindings (GRP-01). */
export interface LeafVerifier {
  verify(accountId: string, deviceId: number, signatureKey: Uint8Array): Promise<BindingVerdict>;
  /** Publishes this device's binding for its MLS signature key (idempotent). */
  publishOwn(signatureKey: Uint8Array): Promise<void>;
}

/** The group contains a device that is not bound to its account; nothing is encrypted to it. */
export class UntrustedGroupMembersError extends Error {
  constructor(readonly devices: string[]) { super('group contains unverified devices'); this.name = 'UntrustedGroupMembersError'; }
}

/** Some invited accounts have no device that can be added right now (no KeyPackage). */
export class MembersUnavailableError extends Error {
  constructor(readonly accountIds: string[]) {
    super('some people cannot be added yet');
    this.name = 'MembersUnavailableError';
  }
}

/** Raised when a membership change raced with another commit; retry after catching up. */
export class GroupBusyError extends Error {
  constructor() {
    super('group changed concurrently; try again');
    this.name = 'GroupBusyError';
  }
}

/** Result of processing an MLS envelope. */
export interface GroupProcessResult {
  ops: StoreOp[];
  groupId: string;
  /** Decrypted application payload and its authenticated sender. */
  application?: { plaintext: Uint8Array; accountId: string; deviceId: number };
  joined?: boolean;
  removed?: boolean;
  /** Membership changed (refresh roles/members). */
  changed?: boolean;
}

/** Prepared group application message (persist ops with the outbox item, then submit). */
export interface PreparedGroupMessage {
  groupId: string;
  epoch: number;
  message: string;
  ops: StoreOp[];
}

export class GroupManager {
  constructor(
    private readonly api: EnclaveApi,
    private readonly store: EncryptedStore,
    private readonly self: { accountId: string; deviceId: number },
    /** Device-binding checks; absent only in unit tests of unrelated behaviour. */
    private readonly bindings?: LeafVerifier,
  ) {}

  // --- keys ---------------------------------------------------------------------------------

  /** Loads or creates this device's MLS signature key. */
  async signer(): Promise<MlsSigner> {
    const existing = await this.store.get<MlsSigner>(GroupNs.signer, 'self');
    if (existing) return existing;
    const created = await generateSigner();
    await this.store.put(GroupNs.signer, 'self', created);
    return created;
  }

  /** Tops up server-side KeyPackages (start-up and KEYPACKAGES_LOW). */
  async ensureKeyPackages(): Promise<void> {
    // Vouch for this device's MLS key first, so members can verify it (GRP-01).
    const signer = await this.signer();
    if (this.bindings && (await this.store.get<string>(GroupNs.signer, 'binding-published')) !== signer.publicKey) {
      await this.bindings.publishOwn(fromBase64Url(signer.publicKey));
      await this.store.put(GroupNs.signer, 'binding-published', signer.publicKey);
    }
    const { oneTimePreKeys: remaining } = await this.api.keyPackageStatus();
    if (remaining >= KEY_PACKAGE_MIN) return;
    const generated = await generateKeyPackages(await this.signer(), this.self.accountId, this.self.deviceId, KEY_PACKAGE_BATCH);
    await this.store.commit(generated.map((kp) => ({ type: 'put', ns: GroupNs.keyPackage, id: kp.ref, value: kp })));
    await this.api.uploadKeyPackages(generated.map((kp) => ({ ref: kp.ref, keyPackage: kp.message })));
  }

  // --- queries ------------------------------------------------------------------------------

  record(groupId: string): Promise<GroupRecord | undefined> {
    return this.store.get<GroupRecord>(GroupNs.group, groupId);
  }

  /** Device addresses currently in the MLS tree, grouped by account. */
  async memberDevices(groupId: string): Promise<Map<string, number[]>> {
    const state = await this.state(groupId);
    const result = new Map<string, number[]>();
    if (!state) return result;
    for (const m of members(state)) {
      const [accountId, deviceId] = splitAddress(m.identity);
      result.set(accountId, [...(result.get(accountId) ?? []), deviceId]);
    }
    return result;
  }

  /** Marks this account as having left (keeps history; stops group sending locally). */
  async markLeft(groupId: string): Promise<void> {
    const record = await this.record(groupId);
    if (record) await this.store.put(GroupNs.group, groupId, { ...record, left: true });
  }

  /** Refreshes roles/members from the DS ACL mirror. */
  async refreshRecord(groupId: string): Promise<GroupRecord | undefined> {
    const record = await this.record(groupId);
    if (!record || record.left) return record;
    try {
      const view = await this.api.group(groupId);
      // Re-read after the network call: E2EE metadata (name, community, version) may have changed
      // meanwhile; only the server-mirrored fields are replaced here.
      const latest = await this.record(groupId) ?? record;
      const updated = { ...latest, members: view.members, adminOnly: view.adminOnly, departed: view.departed ?? [] };
      await this.store.put(GroupNs.group, groupId, updated);
      return updated;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_GROUP_MEMBER') {
        const updated = { ...record, left: true };
        await this.store.put(GroupNs.group, groupId, updated);
        return updated;
      }
      throw error;
    }
  }

  // --- lifecycle ----------------------------------------------------------------------------

  /**
   * Creates a group with the given accounts (and this account's other devices).
   *
   * @returns group ID and the ops to persist (already committed here for the state/record)
   */
  async create(name: string, accountIds: string[], adminOnly = false): Promise<GroupRecord> {
    const accounts = unique(accountIds.filter((a) => a !== this.self.accountId)).sort();
    const signature = JSON.stringify({ name, accounts, adminOnly });
    type Pending = { signature: string; request: CreateGroupRequest; state: string };
    let pending = await this.store.get<Pending>('pending-group-create', signature);
    if (!pending) {
      const signer = await this.signer();
      const claimed = await this.claim([...accounts, this.self.accountId]);
      requireEveryAccount(accounts, claimed);
      const [own] = await generateKeyPackages(signer, this.self.accountId, this.self.deviceId, 1);
      const groupId = randomBytes(32);
      const output = await createGroupWith(signer, own!, groupId, claimed.map((c) => c.keyPackage));
      const id = toBase64Url(groupId);
      pending = { signature, state: serializeState(output.state), request: {
        groupId: id, adminOnly, epoch: epochOf(output.state), members: accounts,
        devices: claimed.map((c) => c.device), welcome: output.welcome,
      } };
      await this.store.put('pending-group-create', signature, pending);
    }
    const view = await this.api.createGroup(pending.request);
    const id = pending.request.groupId;
    const record: GroupRecord = { groupId: id, name, metaVersion: 1, members: view.members, adminOnly: view.adminOnly, left: false };
    await this.store.commit([{ type: 'put', ns: GroupNs.state, id, value: pending.state },
      { type: 'put', ns: GroupNs.group, id, value: record }, { type: 'delete', ns: 'pending-group-create', id: signature }]);
    return record;
  }

  async isJoined(groupId: string): Promise<boolean> { return Boolean(await this.state(groupId)); }

  /** Owners can grant/revoke admin and shared ownership; server enforces final-owner protection. */
  async changeRole(groupId: string, accountId: string, role: GroupRole): Promise<void> {
    const state = await this.requireState(groupId);
    const output = await commit(state, []);
    await this.submitCommit(groupId, state, output, { roleChanges: { [accountId]: role } });
  }

  /** Adds accounts (all their devices with KeyPackages). Requires admin/owner on the server. */
  async addMembers(groupId: string, accountIds: string[]): Promise<void> {
    const state = await this.requireState(groupId);
    const present = await this.memberDevices(groupId);
    const accounts = unique(accountIds).filter((a) => !present.has(a));
    if (accounts.length === 0) return;
    const claimed = await this.claim(accounts);
    requireEveryAccount(accounts, claimed);
    const output = await commit(state, addProposals(claimed.map((c) => c.keyPackage)));
    await this.submitCommit(groupId, state, output, { addMembers: accounts, addDevices: claimed.map((c) => c.device) });
  }

  /** Removes an account and all of its devices. Requires admin/owner on the server. */
  async removeMember(groupId: string, accountId: string): Promise<void> {
    const state = await this.requireState(groupId);
    const leaves = members(state).filter((m) => splitAddress(m.identity)[0] === accountId);
    if (leaves.length === 0) return;
    const output = await commit(state, removeProposals(leaves.map((l) => l.leafIndex)));
    await this.submitCommit(groupId, state, output, {
      removeMembers: [accountId],
      removeDevices: leaves.map((l) => toRef(l.identity)),
    });
  }

  /**
   * Brings this account's devices in a group in line with its active devices: adds linked devices
   * and removes revoked ones. Any member may manage its own devices.
   *
   * @returns whether a commit was made
   */
  async syncOwnDevices(groupId: string, activeDeviceIds: number[]): Promise<boolean> {
    const state = await this.state(groupId);
    const record = await this.record(groupId);
    if (!state || !record || record.left) return false;
    const own = members(state).filter((m) => splitAddress(m.identity)[0] === this.self.accountId);
    const inGroup = new Set(own.map((m) => splitAddress(m.identity)[1]));
    const missing = activeDeviceIds.filter((d) => !inGroup.has(d));
    const stale = own.filter((m) => !activeDeviceIds.includes(splitAddress(m.identity)[1]) && splitAddress(m.identity)[1] !== this.self.deviceId);
    if (missing.length === 0 && stale.length === 0) return false;
    const claimed = missing.length > 0 ? (await this.claim([this.self.accountId])).filter((c) => missing.includes(c.device.deviceId)) : [];
    if (claimed.length === 0 && stale.length === 0) return false;
    const output = await commit(state, [...addProposals(claimed.map((c) => c.keyPackage)), ...removeProposals(stale.map((s) => s.leafIndex))]);
    await this.submitCommit(groupId, state, output, {
      addDevices: claimed.map((c) => c.device),
      removeDevices: stale.map((s) => toRef(s.identity)),
    });
    return true;
  }

  /**
   * Pending-removal gate (specs §4.7): the server refused a group message because revoked devices are
   * still leaves. This device commits their removal when it may — devices of its own account, or any
   * device when it is an owner/admin; ordinary members wait for them (the spec forbids acting on the
   * server's flag alone). Returns whether a removal was committed.
   */
  async resolvePendingRemoval(groupId: string, devices: string[]): Promise<boolean> {
    const state = await this.requireState(groupId);
    const role = (await this.record(groupId))?.members.find((m) => m.accountId === this.self.accountId)?.role;
    const mayRemove = (identity: string) => splitAddress(identity)[0] === this.self.accountId || role === 'owner' || role === 'admin';
    const own = `${this.self.accountId}.${this.self.deviceId}`;
    const leaves = members(state).filter((m) => devices.includes(m.identity) && m.identity !== own && mayRemove(m.identity));
    if (leaves.length === 0) return false;
    const output = await commit(state, removeProposals(leaves.map((l) => l.leafIndex)));
    await this.submitCommit(groupId, state, output, { removeDevices: leaves.map((l) => toRef(l.identity)) });
    return true;
  }

  // --- messages -----------------------------------------------------------------------------

  /** Encrypts padded content for the group's current epoch. */
  async prepareMessage(groupId: string, padded: Uint8Array): Promise<PreparedGroupMessage> {
    const state = await this.requireState(groupId);
    const untrusted = (await this.record(groupId))?.untrustedDevices;
    if (untrusted?.length) throw new UntrustedGroupMembersError(untrusted);
    const result = await encrypt(state, padded);
    return { groupId, epoch: result.epoch, message: result.message, ops: [this.stateOp(groupId, result.state)] };
  }

  /** Processes an MLS envelope (Welcome, commit or application message). */
  async process(envelope: EnvelopeDto): Promise<GroupProcessResult | null> {
    switch (envelope.type) {
      case 'MLS_WELCOME':
        return this.processWelcome(envelope);
      case 'MLS_COMMIT':
        return this.processCommitEnvelope(envelope);
      case 'MLS_PRIVATE':
        return this.processApplication(envelope);
      default:
        return null;
    }
  }

  private async processWelcome(envelope: EnvelopeDto): Promise<GroupProcessResult | null> {
    const groupId = envelope.groupId!;
    let kp: GeneratedKeyPackage | undefined;
    for (const ref of welcomeTargets(envelope.content)) {
      kp = await this.store.get<GeneratedKeyPackage>(GroupNs.keyPackage, ref);
      if (kp) break;
    }
    if (!kp) throw new Error('welcome for an unknown key package');
    const state = await join(envelope.content, await this.signer(), kp);
    const existing = await this.record(groupId);
    const record: GroupRecord = existing ?? { groupId, name: '', metaVersion: 0, members: [], left: false };
    const untrustedDevices = await this.auditLeaves(state);
    return {
      groupId,
      joined: true,
      ops: [
        this.stateOp(groupId, state),
        { type: 'delete', ns: GroupNs.keyPackage, id: kp.ref },
        { type: 'put', ns: GroupNs.group, id: groupId, value: { ...record, left: false, untrustedDevices: untrustedDevices.length ? untrustedDevices : undefined } },
      ],
    };
  }

  private async processCommitEnvelope(envelope: EnvelopeDto): Promise<GroupProcessResult | null> {
    const groupId = envelope.groupId!;
    let state = await this.state(groupId);
    // A commit for a later epoch than ours: our own earlier commit may have been accepted unseen.
    if (state && (envelope.epoch ?? 0) > epochOf(state)) { await this.resolvePendingCommit(groupId); state = await this.state(groupId); }
    if (!state || (envelope.epoch ?? 0) < epochOf(state)) return { groupId, ops: [] }; // not joined yet, or already applied
    const result = await processCommit(state, envelope.content);
    const ops: StoreOp[] = [this.stateOp(groupId, result.state)];
    const record = await this.record(groupId);
    if (result.kind === 'removed') {
      if (record) ops.push({ type: 'put', ns: GroupNs.group, id: groupId, value: { ...record, left: true } });
      return { groupId, ops, removed: true };
    }
    // Every leaf of the new epoch must be vouched for by its account (adds included).
    const untrustedDevices = await this.auditLeaves(result.state);
    if (record && (untrustedDevices.length || record.untrustedDevices?.length)) {
      ops.push({ type: 'put', ns: GroupNs.group, id: groupId, value: { ...record, untrustedDevices: untrustedDevices.length ? untrustedDevices : undefined } });
    }
    return { groupId, ops, changed: true };
  }

  private async processApplication(envelope: EnvelopeDto): Promise<GroupProcessResult | null> {
    const groupId = envelope.groupId!;
    const state = await this.state(groupId);
    if (!state) throw new Error('application message for an unknown group');
    const result = await decrypt(state, envelope.content);
    const [accountId, deviceId] = splitAddress(result.sender);
    // The authenticated MLS sender must match the server-reported source device.
    if (accountId !== envelope.sourceAccount || deviceId !== envelope.sourceDevice) throw new Error('sender mismatch');
    return { groupId, ops: [this.stateOp(groupId, result.state)], application: { plaintext: result.plaintext, accountId, deviceId } };
  }

  // --- internals ----------------------------------------------------------------------------

  private async submitCommit(
    groupId: string,
    before: ClientState,
    output: CommitOutput,
    changes: { addMembers?: string[]; removeMembers?: string[]; addDevices?: DeviceRef[]; removeDevices?: DeviceRef[]; roleChanges?: Record<string, GroupRole> },
  ): Promise<void> {
    const request = { epoch: epochOf(before), submissionId: toBase64Url(randomBytes(16)), commit: output.commit!, welcome: output.welcome, ...changes };
    // Submissions are idempotent: a lost response is retried with the same ID; if the outcome is
    // still unknown, the new state is kept as pending and resolved before any further group work.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.api.groupCommit(groupId, request);
        break;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'EPOCH_CONFLICT') throw new GroupBusyError();
        if (error instanceof NetworkError && attempt < COMMIT_RETRIES) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
        if (error instanceof NetworkError) {
          const pending: PendingCommit = { groupId, submissionId: request.submissionId, state: serializeState(output.state) };
          await this.store.put(GroupNs.pendingCommit, groupId, pending);
        }
        throw error;
      }
    }
    // Only an accepted commit advances local state (specs §6.4).
    await this.store.commit([this.stateOp(groupId, output.state)]);
    await this.refreshRecord(groupId);
  }

  /**
   * Resolves commits sent with an unknown outcome: an accepted one becomes the group's state, one the
   * server never accepted is discarded. Unreachable server: kept for the next attempt.
   */
  async resolvePendingCommits(): Promise<void> {
    for (const pending of await this.store.list<PendingCommit>(GroupNs.pendingCommit)) await this.resolvePendingCommit(pending.groupId);
  }

  private async resolvePendingCommit(groupId: string): Promise<void> {
    const pending = await this.store.get<PendingCommit>(GroupNs.pendingCommit, groupId);
    if (!pending) return;
    try {
      await this.api.groupCommitStatus(groupId, pending.submissionId);
      await this.store.commit([{ type: 'put', ns: GroupNs.state, id: groupId, value: pending.state }, { type: 'delete', ns: GroupNs.pendingCommit, id: groupId }]);
      await this.refreshRecord(groupId);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.status === 404)) await this.store.delete(GroupNs.pendingCommit, groupId);
      else if (!(error instanceof NetworkError)) throw error;
    }
  }

  /** Claims KeyPackages and checks each one's credential matches the device it was claimed for. */
  private async claim(accountIds: string[]) {
    const response = await this.api.claimKeyPackages(accountIds);
    const claimed = response.keyPackages.map((k) => {
      const keyPackage = decodeKeyPackageMessage(k.keyPackage);
      if (keyPackageIdentity(keyPackage) !== `${k.accountId}.${k.deviceId}`) throw new Error('key package identity mismatch');
      return { keyPackage, device: { accountId: k.accountId, deviceId: k.deviceId } };
    });
    if (!this.bindings) return claimed;
    // A KeyPackage whose key its account never vouched for is dropped, as if the device had none.
    const verdicts = await Promise.all(claimed.map((c) => this.bindings!.verify(c.device.accountId, c.device.deviceId, keyPackageSignatureKey(c.keyPackage))));
    return claimed.filter((_, i) => verdicts[i] !== 'invalid');
  }

  /**
   * Device addresses whose leaf signature key fails its account's binding. Devices that have not
   * published a binding yet (older app versions) are tolerated; a binding that does not match is
   * not. This device's own leaf is always trusted.
   */
  private async auditLeaves(state: ClientState): Promise<string[]> {
    if (!this.bindings) return [];
    const own = `${this.self.accountId}.${this.self.deviceId}`;
    const out: string[] = [];
    for (const leaf of memberKeys(state)) {
      if (leaf.identity === own || !leaf.identity) continue;
      const [accountId, deviceId] = splitAddress(leaf.identity);
      if (await this.bindings.verify(accountId, deviceId, leaf.signatureKey) === 'invalid') out.push(leaf.identity);
    }
    return out;
  }

  private async state(groupId: string): Promise<ClientState | undefined> {
    const serialized = await this.store.get<string>(GroupNs.state, groupId);
    return serialized ? deserializeState(serialized) : undefined;
  }

  private async requireState(groupId: string): Promise<ClientState> {
    const state = await this.state(groupId);
    if (!state) throw new Error('not a member of this group');
    return state;
  }

  private stateOp(groupId: string, state: ClientState): StoreOp {
    return { type: 'put', ns: GroupNs.state, id: groupId, value: serializeState(state) };
  }
}

/** Splits `accountId.deviceId`. */
export function splitAddress(identity: string): [string, number] {
  const dot = identity.lastIndexOf('.');
  return [identity.slice(0, dot), Number(identity.slice(dot + 1))];
}

function toRef(identity: string): DeviceRef {
  const [accountId, deviceId] = splitAddress(identity);
  return { accountId, deviceId };
}

/** Every invited account must contribute at least one device, or nobody is added. */
function requireEveryAccount(accounts: string[], claimed: { device: DeviceRef }[]): void {
  const missing = accounts.filter((a) => !claimed.some((c) => c.device.accountId === a));
  if (missing.length > 0) throw new MembersUnavailableError(missing);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
