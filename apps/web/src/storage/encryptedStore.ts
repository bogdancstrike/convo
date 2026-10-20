import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { fromUtf8, toBase64Url, utf8 } from '../lib/bytes';

/**
 * Encrypted local persistence on IndexedDB (specs §8, "web: IndexedDB encrypted records").
 *
 * - Every value is JSON-serialized and sealed with AES-256-GCM under a non-extractable master key.
 * - Record and index keys are HMAC-SHA256 pseudonyms, so peer IDs and conversation IDs are not
 *   stored in clear. Only the record namespace (e.g. "session") and sort timestamps are visible.
 * - {@link EncryptedStore.commit} writes a batch in **one** IndexedDB transaction, which the core
 *   uses to persist decrypt + ratchet advance + message + processed marker atomically before ack.
 *
 * Browser trust note (UI.md §8, specs §28): a non-extractable key stops casual copying of the
 * database but not same-origin script compromise. Passphrase wrapping is tracked in tasks.md.
 */

const DB_VERSION = 1;

interface SealedValue {
  iv: Uint8Array<ArrayBuffer>;
  ct: ArrayBuffer;
}

interface RecordRow extends SealedValue {
  key: string;
  ns: string;
}

interface MessageRow extends SealedValue {
  key: string;
  conv: string;
  sort: number;
}

interface ProcessedRow {
  guid: string;
  at: number;
}

interface EnclaveDb extends DBSchema {
  meta: { key: string; value: CryptoKey | CryptoKeyPair };
  records: { key: string; value: RecordRow; indexes: { ns: string } };
  messages: { key: string; value: MessageRow; indexes: { conv_sort: [string, number] } };
  processed: { key: string; value: ProcessedRow; indexes: { at: number } };
}

/** A stored chat message as seen by the storage layer: an opaque JSON value plus sort/lookup keys. */
export interface StoredMessage<T> {
  conversationId: string;
  messageKey: string;
  sort: number;
  value: T;
}

/** A batched write applied atomically by {@link EncryptedStore.commit}. */
export type StoreOp =
  | { type: 'put'; ns: string; id: string; value: unknown }
  | { type: 'delete'; ns: string; id: string }
  | { type: 'message'; message: StoredMessage<unknown> }
  | { type: 'deleteMessage'; conversationId: string; messageKey: string }
  | { type: 'processed'; guid: string };

type PreparedOp =
  | { type: 'put'; row: RecordRow }
  | { type: 'delete'; key: string }
  | { type: 'message'; row: MessageRow }
  | { type: 'deleteMessage'; key: string }
  | { type: 'processed'; row: ProcessedRow };

export class EncryptedStore {
  private journal: ((ops: StoreOp[]) => Promise<StoreOp[]>) | null = null;

  /** Add durable encrypted archive work to the same transaction as message persistence. */
  setJournal(journal: ((ops: StoreOp[]) => Promise<StoreOp[]>) | null): void { this.journal = journal; }

  private constructor(
    private readonly db: IDBPDatabase<EnclaveDb>,
    private readonly sealKey: CryptoKey,
    private readonly nameKey: CryptoKey,
  ) {}

  /**
   * Opens (or creates) the local database and its keys.
   *
   * @param name database name; tests use unique names
   */
  static async open(name = 'enclave'): Promise<EncryptedStore> {
    const db = await openDB<EnclaveDb>(name, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('meta');
        database.createObjectStore('records', { keyPath: 'key' }).createIndex('ns', 'ns');
        database.createObjectStore('messages', { keyPath: 'key' }).createIndex('conv_sort', ['conv', 'sort']);
        database.createObjectStore('processed', { keyPath: 'guid' }).createIndex('at', 'at');
      },
    });
    const sealKey =
      ((await db.get('meta', 'sealKey')) as CryptoKey | undefined) ??
      (await persistKey(db, 'sealKey', () =>
        crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
      ));
    const nameKey =
      ((await db.get('meta', 'nameKey')) as CryptoKey | undefined) ??
      (await persistKey(db, 'nameKey', () =>
        crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
      ));
    return new EncryptedStore(db, sealKey, nameKey);
  }

  /** Reads a structured-cloneable key (e.g. a non-extractable device signing key pair). */
  async getKey<T extends CryptoKey | CryptoKeyPair>(name: string): Promise<T | undefined> {
    return (await this.db.get('meta', `key:${name}`)) as T | undefined;
  }

  /** Stores a structured-cloneable key without exporting it. */
  async putKey(name: string, key: CryptoKey | CryptoKeyPair): Promise<void> {
    await this.db.put('meta', key as CryptoKey, `key:${name}`);
  }

  /** Reads and decrypts one record. */
  async get<T>(ns: string, id: string): Promise<T | undefined> {
    const row = await this.db.get('records', await this.recordKey(ns, id));
    return row ? this.open<T>(row) : undefined;
  }

  /** Encrypts and writes one record. */
  async put(ns: string, id: string, value: unknown): Promise<void> {
    await this.commit([{ type: 'put', ns, id, value }]);
  }

  /** Deletes one record. */
  async delete(ns: string, id: string): Promise<void> {
    await this.commit([{ type: 'delete', ns, id }]);
  }

  /** Decrypts every record of a namespace. */
  async list<T>(ns: string): Promise<T[]> {
    const rows = await this.db.getAllFromIndex('records', 'ns', ns);
    return Promise.all(rows.map((r) => this.open<T>(r)));
  }

  /** Reads one message. */
  async getMessage<T>(conversationId: string, messageKey: string): Promise<T | undefined> {
    const row = await this.db.get('messages', await this.messageKey(conversationId, messageKey));
    return row ? this.open<T>(row) : undefined;
  }

  /**
   * Reads the newest messages of a conversation in ascending order.
   *
   * @param limit maximum number of messages
   * @param before only messages with `sort` strictly lower than this
   */
  async messages<T>(conversationId: string, limit: number, before = Number.MAX_SAFE_INTEGER): Promise<T[]> {
    const conv = await this.name('conv', conversationId);
    const range = IDBKeyRange.bound([conv, -Infinity], [conv, before], false, true);
    const rows: MessageRow[] = [];
    let cursor = await this.db.transaction('messages').store.index('conv_sort').openCursor(range, 'prev');
    while (cursor && rows.length < limit) {
      rows.push(cursor.value);
      cursor = await cursor.continue();
    }
    rows.reverse();
    return Promise.all(rows.map((r) => this.open<T>(r)));
  }

  /** Deletes every stored message of a conversation (local "clear chat"). */
  async deleteConversationMessages(conversationId: string): Promise<void> {
    const conv = await this.name('conv', conversationId);
    const tx = this.db.transaction('messages', 'readwrite');
    let cursor = await tx.store.index('conv_sort').openCursor(IDBKeyRange.bound([conv, -Infinity], [conv, Infinity]));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  /** @returns whether an envelope GUID was already processed (dedupe, specs §10). */
  async isProcessed(guid: string): Promise<boolean> {
    return (await this.db.count('processed', guid)) > 0;
  }

  /** Deletes processed markers older than `maxAgeMs` (default 30 days). */
  async pruneProcessed(maxAgeMs = 30 * 24 * 3600 * 1000): Promise<void> {
    const tx = this.db.transaction('processed', 'readwrite');
    let cursor = await tx.store.index('at').openCursor(IDBKeyRange.upperBound(Date.now() - maxAgeMs));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  /**
   * Applies a batch atomically. All encryption happens first because an IndexedDB transaction
   * auto-commits as soon as it awaits non-IndexedDB work.
   */
  async commit(ops: StoreOp[], journal = true): Promise<void> {
    if (journal && this.journal) ops = [...ops, ...await this.journal(ops)];
    if (ops.length === 0) return;
    const prepared = await Promise.all(ops.map((op) => this.prepare(op)));
    const tx = this.db.transaction(['records', 'messages', 'processed'], 'readwrite');
    const writes: Promise<unknown>[] = [];
    for (const op of prepared) {
      switch (op.type) {
        case 'put':
          writes.push(tx.objectStore('records').put(op.row));
          break;
        case 'delete':
          writes.push(tx.objectStore('records').delete(op.key));
          break;
        case 'message':
          writes.push(tx.objectStore('messages').put(op.row));
          break;
        case 'deleteMessage':
          writes.push(tx.objectStore('messages').delete(op.key));
          break;
        case 'processed':
          writes.push(tx.objectStore('processed').put(op.row));
          break;
      }
    }
    await Promise.all([...writes, tx.done]);
  }

  /** Deletes the whole database (sign-out / revocation wipe). */
  async destroy(): Promise<void> {
    const name = this.db.name;
    this.db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }

  private async prepare(op: StoreOp): Promise<PreparedOp> {
    switch (op.type) {
      case 'put':
        return { type: 'put', row: { key: await this.recordKey(op.ns, op.id), ns: op.ns, ...(await this.seal(op.value)) } };
      case 'delete':
        return { type: 'delete', key: await this.recordKey(op.ns, op.id) };
      case 'message': {
        const m = op.message;
        return {
          type: 'message',
          row: {
            key: await this.messageKey(m.conversationId, m.messageKey),
            conv: await this.name('conv', m.conversationId),
            sort: m.sort,
            ...(await this.seal(m.value)),
          },
        };
      }
      case 'deleteMessage':
        return { type: 'deleteMessage', key: await this.messageKey(op.conversationId, op.messageKey) };
      case 'processed':
        return { type: 'processed', row: { guid: op.guid, at: Date.now() } };
    }
  }

  private recordKey(ns: string, id: string): Promise<string> {
    return this.name(ns, id);
  }

  private messageKey(conversationId: string, messageKey: string): Promise<string> {
    return this.name('msg', `${conversationId}\u0000${messageKey}`);
  }

  /** Domain-separated HMAC pseudonym of a key. */
  private async name(domain: string, value: string): Promise<string> {
    const mac = await crypto.subtle.sign('HMAC', this.nameKey, utf8(`enclave-store-v1\u0000${domain}\u0000${value}`));
    return toBase64Url(mac);
  }

  private async seal(value: unknown): Promise<SealedValue> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.sealKey, utf8(JSON.stringify(value)));
    return { iv, ct };
  }

  private async open<T>(row: SealedValue): Promise<T> {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, this.sealKey, row.ct);
    return JSON.parse(fromUtf8(plain)) as T;
  }
}

async function persistKey(
  db: IDBPDatabase<EnclaveDb>,
  name: string,
  create: () => Promise<CryptoKey>,
): Promise<CryptoKey> {
  const key = await create();
  await db.put('meta', key, name);
  return key;
}
