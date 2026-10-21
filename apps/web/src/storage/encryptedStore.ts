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
 * database but not same-origin script compromise.
 *
 * Optional passphrase lock (WEB-01, specs §28): the record key and an outer pseudonym key are
 * wrapped with a key derived by Argon2id from the passphrase and are not stored usably on disk;
 * opening then needs the passphrase. Pseudonyms become `HMAC(outer, HMAC(inner, …))`, so the
 * legacy inner key left on disk cannot link IDs by itself. The device request-signing key is a
 * non-extractable WebCrypto key and stays unwrapped: it authenticates to the server (revocable)
 * but decrypts nothing.
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

/** Passphrase lock parameters and the wrapped key material (meta `lock`). */
export interface LockRecord {
  v: 1;
  kdf: { alg: 'argon2id'; salt: Uint8Array<ArrayBuffer>; memoryKiB: number; iterations: number; parallelism: number };
  iv: Uint8Array<ArrayBuffer>;
  /** AES-GCM(KEK, sealKey raw ‖ outerKey raw). */
  wrapped: ArrayBuffer;
  /** Auto-lock after this many minutes without interaction (0 = only manually). */
  idleMinutes: number;
}

/** The store is passphrase-locked; open it with {@link EncryptedStore.open}'s passphrase. */
export class StoreLockedError extends Error {
  constructor() { super('store locked'); this.name = 'StoreLockedError'; }
}

/** The passphrase did not unwrap the keys. */
export class WrongPassphraseError extends Error {
  constructor() { super('wrong passphrase'); this.name = 'WrongPassphraseError'; }
}

/** Argon2id cost (specs §21.3: m = 64 MiB, t = 3). Tests may lower it. */
export const DEFAULT_KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 };
/** Minimum passphrase length enforced by the store (the UI explains it). */
export const MIN_PASSPHRASE = 10;

interface EnclaveDb extends DBSchema {
  meta: { key: string; value: CryptoKey | CryptoKeyPair | LockRecord };
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
    private sealKey: CryptoKey,
    private readonly nameKey: CryptoKey,
    /** Outer pseudonym layer (present once a passphrase was ever set). */
    private outerKey: CryptoKey | undefined,
    private lock: LockRecord | undefined,
  ) {}

  /** Serializes writes with re-keying (one writer tab is ensured by the leader lock). */
  private writes: Promise<unknown> = Promise.resolve();

  /** Whether this store is protected by a passphrase. */
  get passphraseEnabled(): boolean { return !!this.lock; }
  /** Auto-lock delay in minutes (0 = manual only); meaningful when a passphrase is set. */
  get idleMinutes(): number { return this.lock?.idleMinutes ?? 0; }

  /** True when the database exists and is passphrase-locked (no keys needed to ask). */
  static async isLocked(name = 'enclave'): Promise<boolean> {
    const db = await openDB<EnclaveDb>(name, DB_VERSION, { upgrade: createSchema });
    try { return !!(await db.get('meta', 'lock')); } finally { db.close(); }
  }

  /**
   * Opens (or creates) the local database and its keys.
   *
   * @param name database name; tests use unique names
   */
  static async open(name = 'enclave', passphrase?: string): Promise<EncryptedStore> {
    const db = await openDB<EnclaveDb>(name, DB_VERSION, { upgrade: createSchema });
    const nameKeyStored = (await db.get('meta', 'nameKey')) as CryptoKey | undefined;
    const lock = (await db.get('meta', 'lock')) as LockRecord | undefined;
    if (lock) {
      if (passphrase === undefined) { db.close(); throw new StoreLockedError(); }
      let keys: { seal: CryptoKey; outer: CryptoKey };
      try { keys = await unwrapKeys(lock, passphrase, false); } catch (e) { db.close(); throw e; }
      return new EncryptedStore(db, keys.seal, nameKeyStored!, keys.outer, lock);
    }
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
    return new EncryptedStore(db, sealKey, nameKey, (await db.get('meta', 'outerKey')) as CryptoKey | undefined, undefined);
  }

  /**
   * Protects the store with a passphrase. The first time, the record key cannot be wrapped (it was
   * created non-extractable), so every record and message is re-encrypted under new keys in one
   * transaction; afterwards the keys are kept wrappable and changes are cheap.
   */
  async enablePassphrase(passphrase: string, idleMinutes = 5, kdf = DEFAULT_KDF): Promise<void> {
    checkPassphrase(passphrase);
    if (this.lock) throw new Error('passphrase already set');
    await this.exclusive(async () => {
      const seal = this.sealKey.extractable && this.outerKey?.extractable ? this.sealKey : undefined;
      if (seal && this.outerKey) {
        const lock = await wrapKeys(seal, this.outerKey, passphrase, idleMinutes, kdf);
        const tx = this.db.transaction('meta', 'readwrite');
        await Promise.all([tx.store.put(lock, 'lock'), tx.store.delete('sealKey'), tx.store.delete('outerKey'), tx.done]);
        this.lock = lock;
        return;
      }
      await this.rekey(passphrase, idleMinutes, kdf);
    });
  }

  /** Replaces the passphrase (needs the current one). */
  async changePassphrase(current: string, next: string): Promise<void> {
    checkPassphrase(next);
    if (!this.lock) throw new Error('no passphrase set');
    const lock = this.lock;
    await this.exclusive(async () => {
      const keys = await unwrapKeys(lock, current, true);
      const replaced = await wrapKeys(keys.seal, keys.outer, next, lock.idleMinutes, lock.kdf);
      await this.db.put('meta', replaced, 'lock');
      this.lock = replaced;
    });
  }

  /** Removes the passphrase: the keys are stored on this device again (needs the current one). */
  async disablePassphrase(current: string): Promise<void> {
    if (!this.lock) return;
    const lock = this.lock;
    await this.exclusive(async () => {
      const keys = await unwrapKeys(lock, current, true);
      const tx = this.db.transaction('meta', 'readwrite');
      await Promise.all([tx.store.put(keys.seal, 'sealKey'), tx.store.put(keys.outer, 'outerKey'), tx.store.delete('lock'), tx.done]);
      this.lock = undefined;
      this.sealKey = keys.seal;
      this.outerKey = keys.outer;
    });
  }

  /** Changes the auto-lock delay (stored with the lock parameters). */
  async setIdleMinutes(minutes: number): Promise<void> {
    if (!this.lock || !Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) throw new Error('invalid auto-lock');
    const lock = { ...this.lock, idleMinutes: minutes };
    await this.db.put('meta', lock, 'lock');
    this.lock = lock;
  }

  /** One-time migration to wrappable keys: re-seal every value and add the outer name layer. */
  private async rekey(passphrase: string, idleMinutes: number, kdf: typeof DEFAULT_KDF): Promise<void> {
    const seal = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const outer = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, true, ['sign']);
    const lock = await wrapKeys(seal, outer, passphrase, idleMinutes, kdf);
    // Read everything first: an IndexedDB transaction cannot span WebCrypto awaits.
    const records = await this.db.getAll('records');
    const messages = await this.db.getAll('messages');
    const rename = async (key: string) => this.outerKey ? key : toBase64Url(await crypto.subtle.sign('HMAC', outer, utf8(key)));
    const reseal = async <T extends SealedValue>(row: T) => {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, this.sealKey, row.ct);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, seal, plain) };
    };
    if (this.outerKey) throw new Error('unexpected outer key without extractable record key');
    const newRecords = await Promise.all(records.map(async (r) => ({ ...r, key: await rename(r.key), ...(await reseal(r)) })));
    const newMessages = await Promise.all(messages.map(async (m) => ({ ...m, key: await rename(m.key), conv: await rename(m.conv), ...(await reseal(m)) })));
    const tx = this.db.transaction(['meta', 'records', 'messages'], 'readwrite');
    const writes: Promise<unknown>[] = [tx.objectStore('records').clear(), tx.objectStore('messages').clear()];
    for (const r of newRecords) writes.push(tx.objectStore('records').put(r));
    for (const m of newMessages) writes.push(tx.objectStore('messages').put(m));
    writes.push(tx.objectStore('meta').put(lock, 'lock'), tx.objectStore('meta').delete('sealKey'), tx.objectStore('meta').delete('outerKey'));
    await Promise.all([...writes, tx.done]);
    // Continue with non-extractable copies in memory.
    const fresh = await unwrapKeys(lock, passphrase, false);
    this.sealKey = fresh.seal;
    this.outerKey = fresh.outer;
    this.lock = lock;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work, work);
    this.writes = run.catch(() => undefined);
    return run;
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
    return this.exclusive(() => this.commitNow(ops, journal));
  }

  private async commitNow(ops: StoreOp[], journal: boolean): Promise<void> {
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
    const inner = toBase64Url(await crypto.subtle.sign('HMAC', this.nameKey, utf8(`enclave-store-v1\u0000${domain}\u0000${value}`)));
    return this.outerKey ? toBase64Url(await crypto.subtle.sign('HMAC', this.outerKey, utf8(inner))) : inner;
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

function createSchema(database: IDBPDatabase<EnclaveDb>): void {
  database.createObjectStore('meta');
  database.createObjectStore('records', { keyPath: 'key' }).createIndex('ns', 'ns');
  database.createObjectStore('messages', { keyPath: 'key' }).createIndex('conv_sort', ['conv', 'sort']);
  database.createObjectStore('processed', { keyPath: 'guid' }).createIndex('at', 'at');
}

function checkPassphrase(passphrase: string): void {
  if ([...passphrase].length < MIN_PASSPHRASE) throw new Error('passphrase too short');
}

/** Argon2id → AES-256-GCM key-encryption key (never stored). */
async function deriveKek(passphrase: string, kdf: LockRecord['kdf']): Promise<CryptoKey> {
  const { argon2id } = await import('hash-wasm');
  const raw = await argon2id({ password: passphrase.normalize('NFC'), salt: kdf.salt, memorySize: kdf.memoryKiB, iterations: kdf.iterations,
    parallelism: kdf.parallelism, hashLength: 32, outputType: 'binary' });
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function wrapKeys(seal: CryptoKey, outer: CryptoKey, passphrase: string, idleMinutes: number, kdf: typeof DEFAULT_KDF): Promise<LockRecord> {
  const params = { alg: 'argon2id' as const, salt: crypto.getRandomValues(new Uint8Array(16)), ...kdf };
  const kek = await deriveKek(passphrase, params);
  const material = new Uint8Array(64);
  material.set(new Uint8Array(await crypto.subtle.exportKey('raw', seal)), 0);
  material.set(new Uint8Array(await crypto.subtle.exportKey('raw', outer)), 32);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8('convo-store-lock-v1') }, kek, material);
  material.fill(0);
  return { v: 1, kdf: params, iv, wrapped, idleMinutes };
}

async function unwrapKeys(lock: LockRecord, passphrase: string, extractable: boolean): Promise<{ seal: CryptoKey; outer: CryptoKey }> {
  const kek = await deriveKek(passphrase, lock.kdf);
  let material: Uint8Array<ArrayBuffer>;
  try {
    material = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: lock.iv, additionalData: utf8('convo-store-lock-v1') }, kek, lock.wrapped));
  } catch {
    throw new WrongPassphraseError();
  }
  try {
    return {
      seal: await crypto.subtle.importKey('raw', material.slice(0, 32), 'AES-GCM', extractable, ['encrypt', 'decrypt']),
      outer: await crypto.subtle.importKey('raw', material.slice(32), { name: 'HMAC', hash: 'SHA-256' }, extractable, ['sign']),
    };
  } finally { material.fill(0); }
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
