import { ApiError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import type { DeviceRef, EnvelopeDto, GroupRole } from '../api/types';
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
  type MlsSigner,
} from '../crypto/mls';
import { randomBytes, toBase64Url } from '../lib/bytes';
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
} as const;

/** Keep at least this many KeyPackages on the server; upload {@link KEY_PACKAGE_BATCH} when below. */
const KEY_PACKAGE_MIN = 10;
const KEY_PACKAGE_BATCH = 20;

/** Locally known group facts (name and roles come from E2EE metadata and the DS ACL mirror). */
export interface GroupRecord {
  groupId: string;
  name: string;
  /** Monotonic metadata version (highest wins). */
  metaVersion: number;
  members: { accountId: string; role: GroupRole }[];
  /** This device was removed or left. */
  left: boolean;
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

  /** Refreshes roles/members from the DS ACL mirror. */
  async refreshRecord(groupId: string): Promise<GroupRecord | undefined> {
    const record = await this.record(groupId);
    if (!record || record.left) return record;
    try {
      const view = await this.api.group(groupId);
      const updated = { ...record, members: view.members };
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
  async create(name: string, accountIds: string[]): Promise<GroupRecord> {
    const signer = await this.signer();
    const accounts = unique(accountIds.filter((a) => a !== this.self.accountId));
    const claimed = await this.claim([...accounts, this.self.accountId]);
    requireEveryAccount(accounts, claimed);
    const [own] = await generateKeyPackages(signer, this.self.accountId, this.self.deviceId, 1);
    const groupId = randomBytes(32);
    const output = await createGroupWith(signer, own!, groupId, claimed.map((c) => c.keyPackage));
    const id = toBase64Url(groupId);
    const view = await this.api.createGroup({
      groupId: id,
      epoch: epochOf(output.state),
      members: accounts,
      devices: claimed.map((c) => c.device),
      welcome: output.welcome,
    });
    const record: GroupRecord = { groupId: id, name, metaVersion: 1, members: view.members, left: false };
    await this.store.commit([this.stateOp(id, output.state), { type: 'put', ns: GroupNs.group, id, value: record }]);
    return record;
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

  // --- messages -----------------------------------------------------------------------------

  /** Encrypts padded content for the group's current epoch. */
  async prepareMessage(groupId: string, padded: Uint8Array): Promise<PreparedGroupMessage> {
    const state = await this.requireState(groupId);
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
    return {
      groupId,
      joined: true,
      ops: [
        this.stateOp(groupId, state),
        { type: 'delete', ns: GroupNs.keyPackage, id: kp.ref },
        { type: 'put', ns: GroupNs.group, id: groupId, value: { ...record, left: false } },
      ],
    };
  }

  private async processCommitEnvelope(envelope: EnvelopeDto): Promise<GroupProcessResult | null> {
    const groupId = envelope.groupId!;
    const state = await this.state(groupId);
    if (!state || (envelope.epoch ?? 0) < epochOf(state)) return { groupId, ops: [] }; // not joined yet, or already applied
    const result = await processCommit(state, envelope.content);
    const ops: StoreOp[] = [this.stateOp(groupId, result.state)];
    if (result.kind === 'removed') {
      const record = await this.record(groupId);
      if (record) ops.push({ type: 'put', ns: GroupNs.group, id: groupId, value: { ...record, left: true } });
      return { groupId, ops, removed: true };
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
    changes: { addMembers?: string[]; removeMembers?: string[]; addDevices?: DeviceRef[]; removeDevices?: DeviceRef[] },
  ): Promise<void> {
    try {
      await this.api.groupCommit(groupId, {
        epoch: epochOf(before),
        submissionId: toBase64Url(randomBytes(16)),
        commit: output.commit!,
        welcome: output.welcome,
        ...changes,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EPOCH_CONFLICT') throw new GroupBusyError();
      throw error;
    }
    // Only an accepted commit advances local state (specs §6.4).
    await this.store.commit([this.stateOp(groupId, output.state)]);
    await this.refreshRecord(groupId);
  }

  /** Claims KeyPackages and checks each one's credential matches the device it was claimed for. */
  private async claim(accountIds: string[]) {
    const response = await this.api.claimKeyPackages(accountIds);
    return response.keyPackages.map((k) => {
      const keyPackage = decodeKeyPackageMessage(k.keyPackage);
      if (keyPackageIdentity(keyPackage) !== `${k.accountId}.${k.deviceId}`) throw new Error('key package identity mismatch');
      return { keyPackage, device: { accountId: k.accountId, deviceId: k.deviceId } };
    });
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
