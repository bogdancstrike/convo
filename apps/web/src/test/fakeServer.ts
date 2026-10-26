import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import { ApiError } from '../api/errors';
import type {
  AccountDto, ClaimResponse, DeviceMessageDto, Directive, EnvelopeDto, PreKeyDto, PrimaryRegistrationRequest, RegistrationResponse,
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
  socket?: FakeServerSocket;
  revoked?: boolean;
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
  private readonly tickets = new Map<string, { accountId: string; deviceId: number }>();
  private readonly handlers = new Map<string, Handler>();
  /** Every call the server received, as `method` names, for assertions. */
  readonly calls: string[] = [];
  private nextGuid = 1;
  now = () => Date.now();

  constructor() {
    instance = this;
    vi.stubGlobal('WebSocket', FakeServerSocket);
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
      mlsBindings: () => [],
      publishMlsBinding: () => undefined,
      keyPackageStatus: () => ({ available: 100 }),
      uploadKeyPackages: () => undefined,
      myGroups: () => [],
      recoveryStatus: () => ({ configured: false }),
      ktAccount: () => { throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND'); },
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
    account.devices.set(deviceId, { deviceId, registrationId: request.registrationId, signedPreKey: request.signedPreKey, preKeys: [...request.preKeys], mailbox: [] });
    account.deviceListVersion++;
    return { accountId: account.accountId, deviceId, deviceListVersion: account.deviceListVersion };
  }

  private device(caller: { accountId: string; deviceId: number }): FakeDevice {
    const device = this.accounts.get(caller.accountId)?.devices.get(caller.deviceId);
    if (!device || device.revoked) throw new ApiError(401, 'DEVICE_REVOKED', 'DEVICE_REVOKED');
    return device;
  }

  private accountDto(accountId: string): AccountDto {
    const a = this.accounts.get(accountId);
    if (!a) throw new ApiError(404, 'NOT_FOUND', 'NOT_FOUND');
    return { accountId: a.accountId, username: a.username, displayName: a.displayName, identityKey: a.identityKey };
  }

  private active(a: FakeAccount): FakeDevice[] { return [...a.devices.values()].filter((d) => !d.revoked); }

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
