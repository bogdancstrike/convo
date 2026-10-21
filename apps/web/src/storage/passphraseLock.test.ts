import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { EncryptedStore, StoreLockedError, WrongPassphraseError } from './encryptedStore';

const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 };
const PASS = 'correct horse battery';

async function seeded(name: string): Promise<EncryptedStore> {
  const store = await EncryptedStore.open(name);
  await store.put('session', 'peer-a.1', { ratchet: 'secret-1' });
  await store.commit([{ type: 'message', message: { conversationId: 'conv-1', messageKey: 'm1', sort: 1, value: { body: 'hello' } } },
    { type: 'message', message: { conversationId: 'conv-1', messageKey: 'm2', sort: 2, value: { body: 'world' } } }]);
  return store;
}

describe('passphrase lock', () => {
  it('migrates existing data, then needs the passphrase to open', async () => {
    const name = `lock-${Math.random()}`;
    const store = await seeded(name);
    await store.enablePassphrase(PASS, 5, FAST);
    expect(store.passphraseEnabled).toBe(true);
    // Still usable in this session after re-keying.
    expect(await store.get('session', 'peer-a.1')).toEqual({ ratchet: 'secret-1' });
    await store.put('session', 'peer-b.1', { ratchet: 'secret-2' });

    expect(await EncryptedStore.isLocked(name)).toBe(true);
    await expect(EncryptedStore.open(name)).rejects.toBeInstanceOf(StoreLockedError);
    await expect(EncryptedStore.open(name, 'wrong passphrase!')).rejects.toBeInstanceOf(WrongPassphraseError);
    const reopened = await EncryptedStore.open(name, PASS);
    expect(await reopened.get('session', 'peer-a.1')).toEqual({ ratchet: 'secret-1' });
    expect(await reopened.get('session', 'peer-b.1')).toEqual({ ratchet: 'secret-2' });
    expect((await reopened.messages<{ body: string }>('conv-1', 10)).map((m) => m.body)).toEqual(['hello', 'world']);
    expect(reopened.idleMinutes).toBe(5);
  });

  it('changes and removes the passphrase without losing data', async () => {
    const name = `lock-${Math.random()}`;
    const store = await seeded(name);
    await store.enablePassphrase(PASS, 5, FAST);
    await expect(store.changePassphrase('not the passphrase', 'another long secret')).rejects.toBeInstanceOf(WrongPassphraseError);
    await store.changePassphrase(PASS, 'another long secret');
    await expect(EncryptedStore.open(name, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    const changed = await EncryptedStore.open(name, 'another long secret');
    await changed.setIdleMinutes(15);
    expect((await EncryptedStore.open(name, 'another long secret')).idleMinutes).toBe(15);

    await changed.disablePassphrase('another long secret');
    expect(await EncryptedStore.isLocked(name)).toBe(false);
    const open = await EncryptedStore.open(name);
    expect(await open.get('session', 'peer-a.1')).toEqual({ ratchet: 'secret-1' });
    // Re-enabling after removal does not need another migration and keeps the data.
    await open.enablePassphrase(PASS, 1, FAST);
    expect(await (await EncryptedStore.open(name, PASS)).getMessage('conv-1', 'm2')).toEqual({ body: 'world' });
  });

  it('rejects short passphrases', async () => {
    const store = await EncryptedStore.open(`lock-${Math.random()}`);
    await expect(store.enablePassphrase('short', 5, FAST)).rejects.toThrow('too short');
    expect(store.passphraseEnabled).toBe(false);
  });
});
