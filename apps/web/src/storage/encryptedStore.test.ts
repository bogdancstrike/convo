import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { EncryptedStore } from './encryptedStore';

describe('EncryptedStore', () => {
  it('round-trips encrypted records and lists by namespace', async () => {
    const store = await EncryptedStore.open(`t-${Math.random()}`);
    await store.put('session', 'a.1', { record: 'x' });
    await store.put('session', 'b.1', { record: 'y' });
    await store.put('other', 'a.1', 1);
    expect(await store.get('session', 'a.1')).toEqual({ record: 'x' });
    expect((await store.list('session')).length).toBe(2);
    await store.delete('session', 'a.1');
    expect(await store.get('session', 'a.1')).toBeUndefined();
  });

  it('commits messages and processed markers atomically and pages in order', async () => {
    const store = await EncryptedStore.open(`t-${Math.random()}`);
    await store.commit([
      { type: 'message', message: { conversationId: 'c', messageKey: 'm2', sort: 2, value: { n: 2 } } },
      { type: 'message', message: { conversationId: 'c', messageKey: 'm1', sort: 1, value: { n: 1 } } },
      { type: 'message', message: { conversationId: 'd', messageKey: 'm3', sort: 3, value: { n: 3 } } },
      { type: 'processed', guid: 'g1' },
    ]);
    expect(await store.messages('c', 10)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await store.messages('c', 1)).toEqual([{ n: 2 }]);
    expect(await store.messages('c', 10, 2)).toEqual([{ n: 1 }]);
    expect(await store.isProcessed('g1')).toBe(true);
    expect(await store.isProcessed('g2')).toBe(false);
  });

  it('does not store record identifiers in clear', async () => {
    const name = `t-${Math.random()}`;
    const store = await EncryptedStore.open(name);
    await store.put('session', 'secret-peer-id.1', { v: 1 });
    const raw = await new Promise<unknown[]>((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => {
        const all = req.result.transaction('records').objectStore('records').getAll();
        all.onsuccess = () => resolve(all.result as unknown[]);
      };
    });
    expect(JSON.stringify(raw)).not.toContain('secret-peer-id');
  });
});
