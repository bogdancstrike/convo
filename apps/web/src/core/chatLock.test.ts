import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnclaveClient } from './client';
import { SignalStore } from '../crypto/signalStore';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * "Require authentication" per chat (passwordless on): every kind of chat — 1:1, note to self,
 * group, channel — can be locked once a passkey is registered, and unlocked at any time.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let passkey = true;
let credentialsDown = false;

beforeEach(async () => {
  passkey = true; credentialsDown = false;
  server = new FakeServer();
  server.handle('accountCredentials', () => {
    if (credentialsDown) throw new Error('IdP unavailable');
    return { state: 'available', passkey, otp: false };
  });
  ana = await server.enroll('ana'); bob = await server.enroll('bob');
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  await until(() => server.accounts.get(bob.account.accountId)!.devices.get(1)!.keyPackages.length > 0);
});
afterEach(() => server.close(ana, bob));

const peer = () => ({ accountId: bob.account.accountId, username: 'bob' });

async function chats() {
  const direct = await ana.client.openConversation(peer());
  const note = await ana.client.openConversation({ accountId: ana.account.accountId, username: 'ana' });
  const group = await ana.client.createGroup('Team', [peer()]);
  const channel = await ana.client.createGroup('News', [peer()], true);
  return { direct: direct.id, note: note.id, group: group.id, channel: channel.id };
}

describe('per-chat lock', () => {
  it.each(['direct', 'note', 'group', 'channel'] as const)('a %s chat can be locked with a passkey and unlocked again', async (kind) => {
    await ana.client.credentialStatus(true);
    const id = (await chats())[kind];
    expect(ana.client.isLocked(id)).toBe(false);
    await ana.client.setChatLocked(id, true);
    expect(ana.client.isLocked(id)).toBe(true);
    await ana.client.setChatLocked(id, false);
    expect(ana.client.isLocked(id)).toBe(false);
  });

  it('locking needs a registered passkey; unlocking never does', async () => {
    const { direct, group } = await chats();
    await ana.client.credentialStatus(true);
    await ana.client.setChatLocked(group, true);
    passkey = false;
    await ana.client.credentialStatus(true);
    expect(ana.client.passkeyEnrolled).toBe(false);
    await expect(ana.client.setChatLocked(direct, true)).rejects.toThrow('passkey required');
    await ana.client.setChatLocked(group, false);
    expect(ana.client.isLocked(group)).toBe(false);
  });

  it('before the identity provider ever answered, nothing can be locked', async () => {
    const { direct } = await chats();
    expect(ana.client.passkeyEnrolled).toBeNull();
    await expect(ana.client.setChatLocked(direct, true)).rejects.toThrow('passkey required');
  });

  it('an identity-provider outage keeps the last confirmed passkey state', async () => {
    const { direct } = await chats();
    await ana.client.credentialStatus(true);
    credentialsDown = true;
    expect((await ana.client.credentialStatus(true)).state).toBe('unavailable');
    expect(ana.client.passkeyEnrolled).toBe(true);
    await ana.client.setChatLocked(direct, true);
    expect(ana.client.isLocked(direct)).toBe(true);
  });

  it('several chats lock independently and locking twice is harmless', async () => {
    await ana.client.credentialStatus(true);
    const { direct, note, channel } = await chats();
    await ana.client.setChatLocked(direct, true);
    await ana.client.setChatLocked(direct, true);
    await ana.client.setChatLocked(channel, true);
    expect(ana.client.settings.lockedChats.filter((id) => id === direct)).toHaveLength(1);
    expect([direct, note, channel].map((id) => ana.client.isLocked(id))).toEqual([true, false, true]);
  });

  it('locks are kept on this device across restarts and are not shared with the chat partner', async () => {
    await ana.client.credentialStatus(true);
    const { direct } = await chats();
    await ana.client.setChatLocked(direct, true);
    ana.client.stop();
    const restarted = new EnclaveClient((await ana.repos.deviceState())!, ana.api, ana.repos, new SignalStore(ana.store), await ana.repos.settings());
    expect(restarted.isLocked(direct)).toBe(true);
    expect(bob.client.isLocked(ana.account.accountId)).toBe(false);
  });

  it('a lock change is announced to the UI', async () => {
    await ana.client.credentialStatus(true);
    const { group } = await chats();
    const seen: string[][] = [];
    ana.client.on('settings', (s) => seen.push(s.lockedChats));
    await ana.client.setChatLocked(group, true);
    expect(seen.at(-1)).toEqual([group]);
  });
});
