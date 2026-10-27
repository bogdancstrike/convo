import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import { ApiError } from '../api/errors';
import type {
  AccountDto, ClaimResponse, CreateGroupRequest, DeviceRef, GroupCommitRequest, GroupDto, GroupMessageRequest, GroupRole, DeviceMessageDto, Directive, EnvelopeDto, PreKeyDto, PrimaryRegistrationRequest, RegistrationResponse,
  RosterDto, SendRequestDto, SendResultDto, SignedPreKeyDto,
} from '../api/types';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore } from '../storage/encryptedStore';
import { EnclaveClient } from '../core/client';
import { enrollPrimary } from '../core/enrollment';
import { Repositories } from '../core/repositories';

/**
 * In-memory Convo server for core tests: real clients (real Signal sessions, real encrypted store
 * on fake-indexeddb) enroll, claim prekeys, send and receive through it. It implements the server's
 * delivery contract — device-list checks on send, a per-device mailbox, delivery over the WebSocket
 * and removal on ack — and nothing about plaintext, like the real one.
 *
 * Endpoints a test needs beyond these can be added per test with {@link FakeServer.handle}.
 * Calls to anything else reject with `NOT_IMPLEMENTED`, which the client treats like a failed request.
 */

interface FakeDevice {
  deviceId: number;
  registrationId: number;
  signedPreKey: SignedPreKeyDto;
  preKeys: PreKeyDto[];
  mailbox: EnvelopeDto[];
  keyPackages: { ref: string; keyPackage: string }[];
  binding?: { signatureKey: string; binding: string };
  socket?: FakeServerSocket;
  revoked?: boolean;
}

interface FakeGroup {
  groupId: string;
  epoch: number;
  nextSeq: number;
  adminOnly: boolean;
  members: Map<string, GroupRole>;
  devices: DeviceRef[];
  departed: Set<string>;
  bans: Set<string>;
  events: { seq: number; epoch: number; commit: string; submissionId: string; digest: string }[];
  submissions: Map<string, string>;
}

interface FakeAccount {
  accountId: string;
  username: string;
  displayName: string;
  identityKey?: string;
  deviceListVersion: number;
  devices: Map<number, FakeDevice>;
}

type Handler = (caller: { accountId: string; deviceId: number }, ...args: unknown[]) => unknown;

const DEPLOYMENT = 'test-deployment';
let instance: FakeServer | undefined;

export class FakeServer {
  readonly accounts = new Map<string, FakeAccount>();
  readonly groups = new Map<string, FakeGroup>();
  /** Device-linking sessions (provisioning), by ID. */
  readonly provisioning = new Map<string, { id: string; account: FakeAccount; deviceId: number; challenge: string; eph: string; label: string;
    status: 'pending' | 'approved' | 'completed' | 'cancelled'; code?: string; reply?: { ephemeralPublicKey: string; message: string } }>();
  /** Calls created through the API. */
  readonly callsCreated: { callId: string; peer?: string; groupId?: string; video: boolean }[] = [];
  /** Object storage behind the presigned URLs (encrypted blobs only, like S3/MinIO). */
  readonly objects = new Map<string, Uint8Array>();
  private nextObject = 1;
  private readonly tickets = new Map<string, { accountId: string; deviceId: number }>();
  private readonly handlers = new Map<string, Handler>();
  /** Every call the server received, as `method` names, for assertions. */
  readonly calls: string[] = [];
  private nextGuid = 1;
  now = () => Date.now();

  constructor() {
    instance = this;
    vi.stubGlobal('WebSocket', FakeServerSocket);
    // Presigned object URLs (https://objects.test/<id>) are served from memory; nothing else is reachable.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://objects.test/')) return realFetch(input, init);
      const id = url.slice('https://objects.test/'.length).split('?')[0]!;
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = init!.body;
        const bytes: Uint8Array = body instanceof Uint8Array ? body : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body as ArrayBuffer);
        this.objects.set(id, bytes.slice());
        return new Response(null, { status: 200, headers: { ETag: '"etag"' } });
      }
      const stored = this.objects.get(id);
      return stored ? new Response(stored.slice(), { status: 200 }) : new Response(null, { status: 404 });
    });
    // Node environment (WebCrypto rejects jsdom's ArrayBuffers): only the browser globals the core touches.
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test', origin: 'https://convo.test' }, addEventListener: () => undefined, removeEventListener: () => undefined });
      vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: () => undefined, removeEventListener: () => undefined });
    }
  }

  /** Overrides or adds an API method for every device. */
  handle(method: string, handler: Handler): void { this.handlers.set(method, handler); }

  /** Creates an account (sign-in identity) without devices. */
  account(username: string, displayName = username): FakeAccount {
    const accountId = `00000000-0000-4000-8000-${String(this.accounts.size + 1).padStart(12, '0')}`;
    const account: FakeAccount = { accountId, username, displayName, deviceListVersion: 0, devices: new Map() };
    this.accounts.set(accountId, account);
    return account;
  }

  /** The API as seen by one device (or by a not-yet-enrolled browser when `caller` is unset). */
  api(account: FakeAccount, caller?: { deviceId: number }): EnclaveApi {
    const self = this;
    let current = caller ? { accountId: account.accountId, deviceId: caller.deviceId } : undefined;
    const methods: Record<string, (...args: unknown[]) => unknown> = {
      useDevice: (d: unknown) => { const dev = d as { accountId: string; deviceId: number }; current = { accountId: dev.accountId, deviceId: dev.deviceId }; },
      reserve: () => ({ reservationId: `r-${account.accountId}`, accountId: account.accountId, deviceId: account.devices.size + 1, challenge: 'c', deploymentId: DEPLOYMENT, expiresAt: new Date(Date.now() + 600_000).toISOString() }),
      registerPrimary: (_t: unknown, request: unknown) => self.register(account, request as PrimaryRegistrationRequest),
      me: () => ({ accountId: account.accountId, username: account.username, displayName: account.displayName, deviceId: current!.deviceId, identityKey: account.identityKey!, deviceListVersion: account.deviceListVersion }),
      account: (id: unknown) => self.accountDto(id as string),
      lookupAccount: (id: unknown) => self.accountDto(id as string),
      searchDirectory: (q: unknown) => [...self.accounts.values()].filter((a) => a.username.includes(String(q))).map((a) => self.accountDto(a.accountId)),
      roster: (id: unknown) => self.roster(id as string),
      claimKeys: (id: unknown, deviceIds: unknown) => self.claim(id as string, (deviceIds as number[] | undefined) ?? []),
      uploadKeys: (spk: unknown, preKeys: unknown) => { const d = self.device(current!); if (spk) d.signedPreKey = spk as SignedPreKeyDto; d.preKeys.push(...(preKeys as PreKeyDto[])); },
      keyStatus: () => ({ oneTimePreKeys: self.device(current!).preKeys.length }),
      devices: () => [...self.accounts.get(current!.accountId)!.devices.values()].filter((d) => !d.revoked).map((d) => ({ deviceId: d.deviceId, platform: 'web', createdAt: new Date(0).toISOString() })),
      send: (request: unknown) => self.deliver(current!, request as SendRequestDto),
      socketTicket: () => { const ticket = `t${self.tickets.size + 1}`; self.tickets.set(ticket, current!); return { ticket, expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
      history: () => [],
      putHistory: () => undefined,
      policy: () => ({ version: 0 }),
      mlsBindings: (id: unknown) => self.active(self.accounts.get(id as string)!).filter((d) => d.binding).map((d) => ({ deviceId: d.deviceId, ...d.binding! })),
      publishMlsBinding: (signatureKey: unknown, binding: unknown) => { self.device(current!).binding = { signatureKey: signatureKey as string, binding: binding as string }; },
      keyPackageStatus: () => ({ oneTimePreKeys: self.device(current!).keyPackages.length }),
      uploadKeyPackages: (list: unknown) => { self.device(current!).keyPackages.push(...(list as { ref: string; keyPackage: string }[])); },
      claimKeyPackages: (ids: unknown) => self.claimKeyPackages(current!, ids as string[]),
      createGroup: (request: unknown) => self.createGroup(current!, request as CreateGroupRequest),
      group: (id: unknown) => self.groupDto(current!, id as string),
      myGroups: () => [...self.groups.values()].filter((g) => g.members.has(current!.accountId)).map((g) => ({ groupId: g.groupId, epoch: g.epoch, adminOnly: g.adminOnly, role: g.members.get(current!.accountId)!, members: g.members.size })),
      groupCommit: (id: unknown, request: unknown) => self.commit(current!, id as string, request as GroupCommitRequest),
      groupEvents: (id: unknown, from: unknown) => self.memberGroup(current!, id as string, true).events.filter((e) => e.epoch >= (from as number)).slice(0, 100).map((e) => ({ seq: e.seq, epoch: e.epoch, commit: e.commit })),
      groupCommitStatus: (id: unknown, submissionId: unknown) => {
        const e = self.memberGroup(current!, id as string, false).events.find((x) => x.submissionId === submissionId);
        if (!e) throw new ApiError(404, 'NOT_FOUND', 'commit not accepted');
        return { epoch: e.epoch + 1, seq: e.seq, duplicate: true };
      },
      groupMessage: (id: unknown, request: unknown) => self.groupMessage(current!, id as string, request as GroupMessageRequest),
      leaveGroup: (id: unknown) => self.leave(current!, id as string),
      groupBans: (id: unknown) => [...self.memberGroup(current!, id as string, false).bans],
      banMember: (id: unknown, accountId: unknown) => { const g = self.memberGroup(current!, id as string, false); g.bans.add(accountId as string); },
      unbanMember: (id: unknown, accountId: unknown) => { self.memberGroup(current!, id as string, false).bans.delete(accountId as string); },
      recoveryStatus: () => ({ configured: false }),
      ktAccount: () => { throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND'); },
      attachmentUploadForm: () => { const id = `00000000-0000-4000-a000-${String(self.nextObject++).padStart(12, '0')}`; return { attachmentId: id, uploadUrl: `https://objects.test/${id}`, expiresAt: new Date(Date.now() + 600_000).toISOString() }; },
      attachmentDownload: (id: unknown) => {
        if (!self.objects.has(id as string)) throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND');
        return { downloadUrl: `https://objects.test/${id}`, expiresAt: new Date(Date.now() + 600_000).toISOString() };
      },
      openProvisioning: (_t: unknown, eph: unknown, label: unknown) => {
        const id = `prov${self.provisioning.size + 1}`; const deviceId = account.devices.size + 1 + [...self.provisioning.values()].filter((p) => p.account === account).length;
        self.provisioning.set(id, { id, account, deviceId, challenge: `ch-${id}`, eph: eph as string, label: label as string, status: 'pending' });
        return { provisioningId: id, reservationId: `r-${id}`, accountId: account.accountId, deviceId, challenge: `ch-${id}`, deploymentId: DEPLOYMENT, expiresAt: new Date(Date.now() + 600_000).toISOString() };
      },
      provisioningStatus: (_t: unknown, id: unknown) => { const p = self.provisioning.get(id as string)!; return { status: p.status, ...p.reply }; },
      cancelProvisioning: (_t: unknown, id: unknown) => { self.provisioning.get(id as string)!.status = 'cancelled'; },
      pendingProvisioning: () => [...self.provisioning.values()].filter((p) => p.account.accountId === current!.accountId && p.status === 'pending')
        .map((p) => ({ provisioningId: p.id, deviceId: p.deviceId, ephemeralPublicKey: p.eph, clientLabel: p.label, challenge: p.challenge, deploymentId: DEPLOYMENT, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() })),
      provisioningCode: (id: unknown) => { const p = self.provisioning.get(id as string)!; p.code = `code-${id}`; return { code: p.code }; },
      deliverProvisioning: (id: unknown, eph: unknown, message: unknown) => { const p = self.provisioning.get(id as string)!; p.status = 'approved'; p.reply = { ephemeralPublicKey: eph as string, message: message as string }; },
      declineProvisioning: (id: unknown) => { self.provisioning.get(id as string)!.status = 'cancelled'; },
      linkDevice: (_t: unknown, request: unknown) => self.link(account, request as PrimaryRegistrationRequest & { provisioningId: string; provisioningCode: string }),
      unlinkDevice: (deviceId: unknown) => { self.revoke(self.accounts.get(current!.accountId)!, deviceId as number); },
      createCall: (request: unknown) => { const r = request as { peer?: string; groupId?: string; video: boolean }; const callId = `00000000-0000-4000-b000-${String(self.callsCreated.length + 1).padStart(12, "0")}`; self.callsCreated.push({ callId, ...r }); return { callId, room: callId, token: 'lk-token', path: '/rtc', video: r.video }; },
      joinCall: (callId: unknown) => ({ callId, room: callId, token: 'lk-token', path: '/rtc', video: false }),
      endCall: () => undefined,
      reportRecipients: () => [...self.accounts.values()].filter((a) => a.username.startsWith('security')).map((a) => ({ accountId: a.accountId, displayName: a.displayName })),
      lastSeenHeartbeat: () => undefined,
    };
    return new Proxy({} as EnclaveApi, {
      get: (_target, name: string) => {
        if (name === 'then') return undefined;
        return async (...args: unknown[]) => {
          self.calls.push(name);
          const custom = self.handlers.get(name);
          if (custom) return custom(current!, ...args);
          const method = methods[name];
          if (!method) throw new ApiError(501, 'NOT_IMPLEMENTED', `fake server: ${name}`);
          return method(...args);
        };
      },
    });
  }

  /** Enrolls a first device for `username` and returns its started client. */
  async enroll(username: string, displayName = username): Promise<TestDevice> {
    const account = this.account(username, displayName);
    const store = await EncryptedStore.open(`fake-${username}-${Math.random()}`);
    const repos = new Repositories(store);
    const api = this.api(account);
    const device = await enrollPrimary(api, 'token', repos);
    const client = new EnclaveClient(device, api, repos, new SignalStore(store), await repos.settings());
    const result: TestDevice = { account, client, store, repos, api, connection: 'offline' };
    client.on('connection', (state) => { result.connection = state; });
    return result;
  }

  /**
   * Links a new browser to `existing`'s account through the real flow: the new device opens a
   * provisioning session, the existing device approves it (sealed identity transfer), the new device
   * completes enrollment. Returns the new device's (not yet started) client.
   */
  async linkDevice(existing: TestDevice, label = 'Firefox on Linux'): Promise<TestDevice> {
    const { LinkRequest } = await import('../core/linking');
    const store = await EncryptedStore.open(`fake-${existing.account.username}-linked-${Math.random()}`);
    const repos = new Repositories(store);
    const api = this.api(existing.account);
    const request = await LinkRequest.start(api, 'token', label);
    const [incoming] = await existing.client.incomingLinkRequests();
    await existing.client.approveLink(incoming!);
    await until(async () => (await request.poll()) === 'approved');
    const device = await request.complete(repos);
    const client = new EnclaveClient(device, api, repos, new SignalStore(store), await repos.settings());
    const result: TestDevice = { account: existing.account, client, store, repos, api, connection: 'offline' };
    client.on('connection', (state) => { result.connection = state; });
    return result;
  }

  /** Sends a server directive (DEVICE_LIST_CHANGED, KEYS_LOW, …) to one device's socket. */
  directive(account: FakeAccount, deviceId: number, type: Directive): void {
    account.devices.get(deviceId)?.socket?.frame({ requestId: 0, directive: { type } });
  }

  /** Revokes a device: closes its socket with 4401 and refuses its requests from now on. */
  revoke(account: FakeAccount, deviceId: number): void {
    const device = account.devices.get(deviceId);
    if (!device) return;
    device.revoked = true; account.deviceListVersion++;
    device.socket?.serverClose(4401);
  }

  /** Envelopes waiting for a device (not yet acknowledged). */
  mailbox(account: FakeAccount, deviceId = 1): EnvelopeDto[] { return account.devices.get(deviceId)?.mailbox ?? []; }

  private register(account: FakeAccount, request: PrimaryRegistrationRequest): RegistrationResponse {
    if (account.identityKey && account.identityKey !== request.identityKey) throw new ApiError(409, 'ACCOUNT_HAS_DEVICES', 'ACCOUNT_HAS_DEVICES');
    account.identityKey = request.identityKey;
    const deviceId = account.devices.size + 1;
    account.devices.set(deviceId, { deviceId, registrationId: request.registrationId, signedPreKey: request.signedPreKey, preKeys: [...request.preKeys], mailbox: [], keyPackages: [] });
    account.deviceListVersion++;
    return { accountId: account.accountId, deviceId, deviceListVersion: account.deviceListVersion };
  }

  private link(account: FakeAccount, request: PrimaryRegistrationRequest & { provisioningId: string; provisioningCode: string }): RegistrationResponse {
    const p = this.provisioning.get(request.provisioningId);
    if (!p || p.status !== 'approved' || p.code !== request.provisioningCode) throw new ApiError(403, 'FORBIDDEN', 'provisioning not approved');
    if (request.identityKey !== account.identityKey) throw new ApiError(400, 'INVALID_REQUEST', 'identity key differs from the account');
    p.status = 'completed';
    account.devices.set(p.deviceId, { deviceId: p.deviceId, registrationId: request.registrationId, signedPreKey: request.signedPreKey, preKeys: [...request.preKeys], mailbox: [], keyPackages: [] });
    account.deviceListVersion++;
    for (const d of this.active(account)) if (d.deviceId !== p.deviceId) d.socket?.frame({ requestId: 0, directive: { type: 'DEVICE_LIST_CHANGED' } });
    return { accountId: account.accountId, deviceId: p.deviceId, deviceListVersion: account.deviceListVersion };
  }

  device(caller: { accountId: string; deviceId: number }): FakeDevice {
    const device = this.accounts.get(caller.accountId)?.devices.get(caller.deviceId);
    if (!device || device.revoked) throw new ApiError(401, 'DEVICE_REVOKED', 'DEVICE_REVOKED');
    return device;
  }

  private accountDto(accountId: string): AccountDto {
    const a = this.accounts.get(accountId);
    if (!a) throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND');
    return { accountId: a.accountId, username: a.username, displayName: a.displayName, identityKey: a.identityKey };
  }

  active(a: FakeAccount): FakeDevice[] { return [...a.devices.values()].filter((d) => !d.revoked); }

  private roster(accountId: string): RosterDto {
    const a = this.accounts.get(accountId);
    if (!a) throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND');
    return { accountId, deviceListVersion: a.deviceListVersion, devices: this.active(a).map((d) => ({ deviceId: d.deviceId, registrationId: d.registrationId })) };
  }

  private claim(accountId: string, deviceIds: number[]): ClaimResponse {
    const a = this.accounts.get(accountId);
    if (!a || !a.identityKey) throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND');
    const devices = this.active(a).filter((d) => deviceIds.length === 0 || deviceIds.includes(d.deviceId)).map((d) => ({
      deviceId: d.deviceId, registrationId: d.registrationId, signedPreKey: d.signedPreKey, preKey: d.preKeys.shift(),
    }));
    return { accountId, identityKey: a.identityKey, deviceListVersion: a.deviceListVersion, devices };
  }

  /** The server's send contract: exactly the destination's active devices (minus the sender), current registration IDs. */
  deliver(sender: { accountId: string; deviceId: number }, request: SendRequestDto): SendResultDto {
    this.device(sender);
    const target = this.accounts.get(request.destination);
    if (!target) return { ok: false, errorCode: 'NOT_FOUND' };
    const expected = this.active(target).filter((d) => !(target.accountId === sender.accountId && d.deviceId === sender.deviceId));
    const given = new Map<number, DeviceMessageDto>(request.messages.map((m) => [m.deviceId, m]));
    const missingDevices = expected.filter((d) => !given.has(d.deviceId)).map((d) => d.deviceId);
    const extraDevices = [...given.keys()].filter((id) => !expected.some((d) => d.deviceId === id));
    if (missingDevices.length || extraDevices.length) return { ok: false, errorCode: 'DEVICE_MISMATCH', missingDevices, extraDevices };
    const staleDevices = expected.filter((d) => given.get(d.deviceId)!.registrationId !== d.registrationId).map((d) => d.deviceId);
    if (staleDevices.length) return { ok: false, errorCode: 'STALE_DEVICES', staleDevices };
    for (const d of expected) {
      const m = given.get(d.deviceId)!;
      const envelope: EnvelopeDto = {
        guid: `g${this.nextGuid++}`, type: m.type, sourceAccount: sender.accountId, sourceDevice: sender.deviceId,
        serverTimestamp: this.now(), expiresAt: 0, urgent: request.urgent, content: m.content,
      };
      d.mailbox.push(envelope);
      d.socket?.frame({ requestId: 0, envelope });
    }
    return { ok: true };
  }

  // --- groups: the GroupService contract (epoch compare-and-set, roster, roles, fan-out) ----------

  private push(to: DeviceRef[], envelope: Omit<EnvelopeDto, 'guid' | 'serverTimestamp' | 'expiresAt'>): void {
    for (const ref of to) {
      const device = this.accounts.get(ref.accountId)?.devices.get(ref.deviceId);
      if (!device || device.revoked) continue;
      const e: EnvelopeDto = { ...envelope, guid: `g${this.nextGuid++}`, serverTimestamp: this.now(), expiresAt: 0 };
      device.mailbox.push(e);
      device.socket?.frame({ requestId: 0, envelope: e });
    }
  }

  private same(a: DeviceRef, b: DeviceRef): boolean { return a.accountId === b.accountId && a.deviceId === b.deviceId; }

  /** A group the caller is a member (or, with `device`, a member device) of. */
  memberGroup(caller: DeviceRef, groupId: string, device: boolean): FakeGroup {
    this.device(caller);
    const g = this.groups.get(groupId);
    if (!g || !g.members.has(caller.accountId) || (device && !g.devices.some((d) => this.same(d, caller)))) throw new ApiError(403, 'NOT_GROUP_MEMBER', 'not a member');
    return g;
  }

  private groupDto(caller: DeviceRef, groupId: string): GroupDto {
    const g = this.memberGroup(caller, groupId, false);
    return { groupId, epoch: g.epoch, adminOnly: g.adminOnly, members: [...g.members].map(([accountId, role]) => ({ accountId, role })), devices: [...g.devices], departed: [...g.departed] };
  }

  private claimKeyPackages(caller: DeviceRef, accountIds: string[]) {
    this.device(caller);
    const keyPackages: { accountId: string; deviceId: number; keyPackage: string }[] = [];
    const unavailable: DeviceRef[] = [];
    for (const accountId of accountIds) {
      const a = this.accounts.get(accountId);
      if (!a) continue;
      for (const d of this.active(a)) {
        if (accountId === caller.accountId && d.deviceId === caller.deviceId) continue;
        const kp = d.keyPackages.shift();
        if (kp) keyPackages.push({ accountId, deviceId: d.deviceId, keyPackage: kp.keyPackage }); else unavailable.push({ accountId, deviceId: d.deviceId });
      }
    }
    return { keyPackages, unavailable };
  }

  private createGroup(caller: DeviceRef, request: CreateGroupRequest): GroupDto {
    this.device(caller);
    if (this.groups.has(request.groupId)) {
      const existing = this.groups.get(request.groupId)!;
      if (existing.members.get(caller.accountId) === 'owner') return this.groupDto(caller, request.groupId);
      throw new ApiError(400, 'INVALID_REQUEST', 'group ID already used');
    }
    const members = new Map<string, GroupRole>([[caller.accountId, 'owner']]);
    for (const m of request.members) if (m !== caller.accountId) members.set(m, 'member');
    for (const d of request.devices) if (!members.has(d.accountId) || this.same(d, caller)) throw new ApiError(400, 'INVALID_REQUEST', 'invalid initial device');
    const g: FakeGroup = { groupId: request.groupId, epoch: request.epoch, nextSeq: 1, adminOnly: !!request.adminOnly, members,
      devices: [{ accountId: caller.accountId, deviceId: caller.deviceId }, ...request.devices], departed: new Set(), bans: new Set(), events: [], submissions: new Map() };
    this.groups.set(g.groupId, g);
    if (request.welcome && request.devices.length) this.push(request.devices, { type: 'MLS_WELCOME', groupId: g.groupId, epoch: g.epoch, sourceAccount: caller.accountId, sourceDevice: caller.deviceId, urgent: false, content: request.welcome });
    return this.groupDto(caller, g.groupId);
  }

  private commit(caller: DeviceRef, groupId: string, request: GroupCommitRequest) {
    const g = this.memberGroup(caller, groupId, true);
    const digest = `${request.commit}|${request.welcome ?? ''}`;
    const prior = g.events.find((e) => e.submissionId === request.submissionId);
    if (prior) {
      if (prior.digest !== digest) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'submission ID reused with different content');
      return { epoch: prior.epoch + 1, seq: prior.seq, duplicate: true };
    }
    if (request.epoch !== g.epoch) throw new ApiError(409, 'EPOCH_CONFLICT', 'commit is not for the current epoch', { currentEpoch: g.epoch });
    const role = g.members.get(caller.accountId)!;
    const manages = role === 'owner' || role === 'admin';
    const ownDevicesOnly = [...(request.addDevices ?? []), ...(request.removeDevices ?? [])].every((d) => d.accountId === caller.accountId || g.departed.has(d.accountId));
    if (((request.addMembers ?? []).length || (request.removeMembers ?? []).some((a) => !g.departed.has(a)) || !ownDevicesOnly) && !manages) throw new ApiError(403, 'FORBIDDEN_ROLE', 'only admins can change membership');
    if (Object.keys(request.roleChanges ?? {}).length && role !== 'owner') throw new ApiError(403, 'FORBIDDEN_ROLE', 'only owners can change roles');
    if ((request.addMembers ?? []).some((a) => g.bans.has(a))) throw new ApiError(403, 'FORBIDDEN', 'account is banned from this group; unban first');
    const roster = [...g.devices];
    const seq = g.nextSeq++;
    g.events.push({ seq, epoch: g.epoch, commit: request.commit, submissionId: request.submissionId, digest });
    const fromEpoch = g.epoch;
    g.epoch++;
    for (const a of request.addMembers ?? []) g.members.set(a, 'member');
    for (const d of request.addDevices ?? []) if (!g.devices.some((x) => this.same(x, d))) g.devices.push(d);
    g.devices = g.devices.filter((x) => !(request.removeDevices ?? []).some((d) => this.same(x, d)));
    for (const a of request.removeMembers ?? []) { g.members.delete(a); g.departed.delete(a); }
    for (const [a, r] of Object.entries(request.roleChanges ?? {})) g.members.set(a, r);
    this.push(roster.filter((d) => !this.same(d, caller)), { type: 'MLS_COMMIT', groupId, epoch: fromEpoch, groupSeq: seq, sourceAccount: caller.accountId, sourceDevice: caller.deviceId, urgent: false, content: request.commit });
    if (request.welcome && (request.addDevices ?? []).length) this.push(request.addDevices!, { type: 'MLS_WELCOME', groupId, epoch: g.epoch, sourceAccount: caller.accountId, sourceDevice: caller.deviceId, urgent: false, content: request.welcome });
    return { epoch: g.epoch, seq, duplicate: false };
  }

  private groupMessage(caller: DeviceRef, groupId: string, request: GroupMessageRequest) {
    const g = this.memberGroup(caller, groupId, true);
    if (g.adminOnly && !request.interaction && g.members.get(caller.accountId) === 'member') throw new ApiError(403, 'FORBIDDEN_ROLE', 'only admins can post in this channel');
    const key = `${caller.accountId}.${caller.deviceId}/${request.submissionId}`;
    if (g.submissions.has(key)) {
      if (g.submissions.get(key) !== request.message) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'submission ID reused');
      return { ok: true, duplicate: true };
    }
    if (request.epoch !== g.epoch) throw new ApiError(409, 'EPOCH_CONFLICT', 'message is not for the current epoch', { currentEpoch: g.epoch });
    g.submissions.set(key, request.message);
    this.push(g.devices.filter((d) => !this.same(d, caller) && !g.departed.has(d.accountId)),
      { type: 'MLS_PRIVATE', groupId, epoch: request.epoch, sourceAccount: caller.accountId, sourceDevice: caller.deviceId, urgent: !!request.urgent, content: request.message });
    return { ok: true, duplicate: false };
  }

  private leave(caller: DeviceRef, groupId: string): void {
    const g = this.memberGroup(caller, groupId, false);
    const owners = [...g.members.values()].filter((r) => r === 'owner').length;
    if (g.members.get(caller.accountId) === 'owner' && owners === 1 && g.members.size > 1) throw new ApiError(403, 'FORBIDDEN_ROLE', 'make another member owner before leaving');
    g.members.delete(caller.accountId);
    g.departed.add(caller.accountId);
    for (const d of g.devices.filter((x) => x.accountId !== caller.accountId)) this.accounts.get(d.accountId)?.devices.get(d.deviceId)?.socket?.frame({ requestId: 0, directive: { type: 'GROUPS_CHANGED' } });
  }

  /** Socket side: a ticket opens the device's mailbox. */
  connect(socket: FakeServerSocket, ticket: string): FakeDevice | undefined {
    const caller = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!caller) return undefined;
    const device = this.accounts.get(caller.accountId)?.devices.get(caller.deviceId);
    if (!device || device.revoked) return undefined;
    device.socket = socket;
    socket.caller = caller;
    return device;
  }

  /** Socket side: frames from a client. */
  receive(socket: FakeServerSocket, device: FakeDevice, frame: Record<string, unknown>): void {
    this.calls.push(`ws:${Object.keys(frame).find((k) => k !== 'requestId') ?? '?'}`);
    if ('ack' in frame) {
      const guids = new Set((frame.ack as { guids: string[] }).guids);
      device.mailbox = device.mailbox.filter((e) => !guids.has(e.guid));
    } else if ('send' in frame) {
      socket.frame({ requestId: frame.requestId, sendResult: this.deliver(socket.caller!, frame.send as SendRequestDto) });
    } else if ('ping' in frame) {
      socket.frame({ requestId: frame.requestId, pong: {} });
    }
  }

  /**
   * Stops clients, lets queued protocol work finish, deletes their stores and restores the globals.
   * Destroying a store under running work aborts the IndexedDB transactions mid-flight.
   */
  async close(...devices: TestDevice[]): Promise<void> {
    for (const d of devices) d.client.stop();
    await new Promise((r) => setTimeout(r, 50));
    for (const d of devices) await (d.client as unknown as { mutex: { run: (task: () => Promise<void>) => Promise<void> } }).mutex.run(async () => undefined);
    await new Promise((r) => setTimeout(r, 50));
    for (const d of devices) await d.store.destroy().catch(() => undefined);
    vi.unstubAllGlobals();
    instance = undefined;
  }
}

/** A started test client and its storage. */
export interface TestDevice {
  account: FakeAccount;
  client: EnclaveClient;
  store: EncryptedStore;
  repos: Repositories;
  api: EnclaveApi;
  /** Latest socket state the client reported. */
  connection: string;
}

/** The browser WebSocket, connected to the {@link FakeServer} instead of the network. */
export class FakeServerSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeServerSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  caller?: { accountId: string; deviceId: number };
  private device?: FakeDevice;

  constructor(_url: string, protocols: string[]) {
    const ticket = protocols.find((p) => p.startsWith('ticket.'))?.slice(7) ?? '';
    setTimeout(() => {
      const device = instance?.connect(this, ticket);
      if (!device) { this.serverClose(4401); return; }
      this.device = device;
      this.readyState = FakeServerSocket.OPEN;
      this.onopen?.();
      for (const envelope of device.mailbox) this.frame({ requestId: 0, envelope });
      this.frame({ requestId: 0, queueEmpty: {} });
    }, 0);
  }

  send(data: string): void {
    if (this.readyState !== FakeServerSocket.OPEN || !this.device) return;
    const frame = JSON.parse(data) as Record<string, unknown>;
    setTimeout(() => instance?.receive(this, this.device!, frame), 0);
  }

  /** Server → client frame (asynchronous, like the network). */
  frame(frame: Record<string, unknown>): void {
    setTimeout(() => { if (this.readyState === FakeServerSocket.OPEN) this.onmessage?.({ data: JSON.stringify(frame) }); }, 0);
  }

  close(): void { this.serverClose(1000); }

  serverClose(code: number): void {
    if (this.readyState === FakeServerSocket.CLOSED) return;
    this.readyState = FakeServerSocket.CLOSED;
    if (this.device?.socket === this) this.device.socket = undefined;
    setTimeout(() => this.onclose?.({ code }), 0);
  }
}

/** Waits until `condition` holds (polling real time; core work is asynchronous). */
export async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export { KeyHelper };
