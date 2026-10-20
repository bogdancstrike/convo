import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import type { EnclaveApi } from '../api/enclaveApi';
import { SignalStore } from '../crypto/signalStore';
import { EncryptedStore } from '../storage/encryptedStore';
import { EnclaveClient } from './client';
import { DEFAULT_SETTINGS } from './model';
import { Outbox, type OutboxItem } from './outbox';
import { Repositories } from './repositories';
import type { UserProfile } from './profile';

it('preserves overlapping status/photo changes and persists their broadcasts with the profile', async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'convo.test' } });
  const flush = vi.spyOn(Outbox.prototype, 'flush').mockResolvedValue();
  const store = await EncryptedStore.open(`profile-updates-${Math.random()}`);
  try {
    const client = new EnclaveClient({ accountId: 'self', deviceId: 1, username: 'test', deploymentId: 'dev', registeredAt: 1, nextPreKeyId: 1 },
      {} as EnclaveApi, new Repositories(store), new SignalStore(store), DEFAULT_SETTINGS);
    const photo = 'data:image/jpeg;base64,YQ==';
    await Promise.all([client.updateProfile({ status: 'Available after lunch' }), client.updateProfile({ photo })]);
    const profile = await store.get<UserProfile>('profile', 'self');
    expect(profile).toMatchObject({ status: 'Available after lunch', photo });
    expect(client.profiles().get('self')).toEqual(profile);
    const updates = (await store.list<OutboxItem>('outbox')).map((i) => i.content)
      .filter((c) => c.kind === 'profile').map((c) => c.profile).sort((a, b) => a.updatedAt - b.updatedAt);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual(profile);
    expect(updates[1]!.updatedAt).toBeGreaterThan(updates[0]!.updatedAt);
    await client.updateProfile({ photo: undefined });
    expect(await store.get('profile', 'self')).toMatchObject({ status: 'Available after lunch' });
    expect((await store.get<UserProfile>('profile', 'self'))?.photo).toBeUndefined();
  } finally { flush.mockRestore(); vi.unstubAllGlobals(); await store.destroy(); }
});
