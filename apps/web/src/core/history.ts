import type { EnclaveApi } from '../api/enclaveApi';
import { openVault, sealVault, vaultKey } from '../crypto/accountVault';
import { fromBase64Url } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import type { ChatMessage, Conversation } from './model';
import { STATUS_RANK } from './model';
import { RecordNs, Repositories } from './repositories';
import { expired } from './disappearing';

export type HistoryStatus = 'syncing' | 'synced' | 'pending' | 'error';
interface ArchiveRecord { v: 1; kind: 'message' | 'conversation' | 'profile' | 'group'; at: number; value: unknown; }
interface Pending { id: string; ciphertext: string; order: number; }
const PENDING = 'history-pending';

/**
 * Prefer tombstones, then the newest content revision, and monotonic delivery state when
 * histories overlap. Receipts describe one revision: they only merge between equal revisions.
 */
export function mergeArchivedMessage(existing: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (!existing) return incoming;
  // View-once: archives only ever hold the consumed label. A local copy keeps its own state and
  // pointer; opening on another device arrives as the own-device "viewed" sync, not via history.
  if (existing.viewOnce) return existing;
  const newer = (a: ChatMessage, b: ChatMessage) => (a.revision ?? 0) !== (b.revision ?? 0) ? (a.revision ?? 0) > (b.revision ?? 0) : (a.editedAt ?? 0) > (b.editedAt ?? 0);
  const content = existing.deleted || (!incoming.deleted && newer(existing, incoming)) ? existing : incoming;
  // Acknowledgement state is not content: keep the newest own response and every reviewer record.
  const myAck = [existing.myAck, incoming.myAck].filter((x): x is NonNullable<ChatMessage['myAck']> => !!x)
    .sort((x, y) => y.revision - x.revision || x.pending.length - y.pending.length)[0];
  const acks: NonNullable<ChatMessage['acks']> = { ...incoming.acks };
  for (const [id, ack] of Object.entries(existing.acks ?? {})) if (!acks[id] || acks[id].revision < ack.revision) acks[id] = ack;
  const ackState = { ...(myAck ? { myAck } : {}), ...(Object.keys(acks).length ? { acks } : {}), ackRequest: existing.ackRequest ?? incoming.ackRequest };
  if ((existing.revision ?? 0) !== (incoming.revision ?? 0) && !content.deleted) {
    return { ...content, ...ackState, recipientAccountIds: existing.recipientAccountIds ?? incoming.recipientAccountIds, starred: existing.starred ?? incoming.starred,
      serverAt: existing.serverAt ?? incoming.serverAt };
  }
  const status = STATUS_RANK[existing.status ?? 'sent'] > STATUS_RANK[incoming.status ?? 'sent'] ? existing.status : incoming.status;
  const receipts: NonNullable<ChatMessage['receipts']> = {};
  for (const id of new Set([...Object.keys(existing.receipts ?? {}), ...Object.keys(incoming.receipts ?? {})])) {
    const a = existing.receipts?.[id]; const b = incoming.receipts?.[id];
    receipts[id] = { deliveredAt: Math.max(a?.deliveredAt ?? 0, b?.deliveredAt ?? 0) || undefined,
      readAt: Math.max(a?.readAt ?? 0, b?.readAt ?? 0) || undefined };
  }
  return { ...content, ...ackState, status, ...(Object.keys(receipts).length ? { receipts } : {}), recipientAccountIds: existing.recipientAccountIds ?? incoming.recipientAccountIds, starred: existing.starred ?? incoming.starred,
    serverAt: existing.serverAt ?? incoming.serverAt };
}

/** Durable local journal → account archive → other trusted devices. No live protocol state. */
export class AccountHistory {
  private key!: CryptoKey;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  private order = 0;
  private stopped = false;
  constructor(private readonly api: EnclaveApi, private readonly store: EncryptedStore,
    private readonly accountId: string, private readonly deploymentId: string,
    private readonly restored: () => Promise<void>, private readonly status: (status: HistoryStatus) => void,
    private readonly exclusive: (task: () => Promise<void>) => Promise<void>) {}

  private binding(id: string): string { return `CONVO-HISTORY-V1\n${this.deploymentId}\n${this.accountId}\n${id}`; }

  async start(identityPrivate: string): Promise<void> {
    this.key = await vaultKey(fromBase64Url(identityPrivate), `archive/${this.deploymentId}/${this.accountId}`);
    this.store.setJournal((ops) => this.journal(ops));
    if (!await this.store.get('history-meta', 'seeded')) {
      const repos = new Repositories(this.store);
      for (const conversation of await repos.conversations()) {
        await this.store.commit(await this.journal([repos.putConversation(conversation)]), false);
        const messages = await repos.messages(conversation.id, Number.MAX_SAFE_INTEGER);
        for (let i = 0; i < messages.length; i += 50) await this.store.commit(await this.journal(messages.slice(i, i + 50).map((m) => repos.putMessage(m))), false);
      }
      await this.store.put('history-meta', 'seeded', true);
    }
    await this.sync();
    this.timer = setInterval(() => void this.sync(), 3000);
  }

  stop(): void { this.stopped = true; clearInterval(this.timer); this.store.setJournal(null); }

  private async journal(ops: StoreOp[]): Promise<StoreOp[]> {
    const entries: StoreOp[] = [];
    for (const op of ops) {
      let record: ArchiveRecord | undefined;
      // View-once media never enters encrypted history: only its consumed label is archived.
      if (op.type === 'message') {
        const message = op.message.value as ChatMessage;
        record = { v: 1, kind: 'message', at: Date.now(), value: message.viewOnce
          ? { ...message, attachments: undefined, viewOnce: { ...message.viewOnce, state: message.direction === 'out' ? 'sent' : 'opened' } } : message };
      }
      if (op.type === 'put' && ['conversation', 'profile', 'group'].includes(op.ns)) {
        const value = op.ns === 'conversation' ? { ...(op.value as Conversation), draft: undefined } : op.value;
        record = { v: 1, kind: op.ns as ArchiveRecord['kind'], at: Date.now(), value };
      }
      if (!record) continue;
      const id = crypto.randomUUID();
      const ciphertext = await sealVault(this.key, record, this.binding(id));
      entries.push({ type: 'put', ns: PENDING, id, value: { id, ciphertext, order: Date.now() * 1000 + this.order++ % 1000 } satisfies Pending });
    }
    return entries;
  }

  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<void> {
    this.status('syncing');
    try {
      const pending = (await this.store.list<Pending>(PENDING)).sort((a, b) => a.order - b.order);
      for (const entry of pending) {
        if (this.stopped) return;
        await this.api.putHistory(entry.id, entry.ciphertext);
        await this.store.delete(PENDING, entry.id);
      }
      const repos = new Repositories(this.store);
      let cursor = await this.store.get<number>('history-meta', 'cursor') ?? 0;
      let changed = false;
      while (!this.stopped) {
        const page = await this.api.history(cursor);
        if (!page.length) break;
        for (const entry of page) {
          await this.exclusive(async () => {
          const record = await openVault<ArchiveRecord>(this.key, entry.ciphertext, this.binding(entry.id));
          if (record.v !== 1) throw new Error('unsupported archive version');
          const ops: StoreOp[] = [];
          if (record.kind === 'message') {
            const message = record.value as ChatMessage;
            if (typeof message.conversationId !== 'string' || typeof message.authorId !== 'string' || typeof message.id !== 'string' || !Number.isFinite(message.sort)) throw new Error('invalid archived message');
            const existing = await repos.message(message.conversationId, message.authorId, message.id);
            // Disappearing messages past their deadline are never restored.
            if (!expired(message, Date.now()) && !await repos.isLocallyDeleted(message)) ops.push(repos.putMessage(mergeArchivedMessage(existing, message)));
          } else if (record.kind === 'conversation') {
            const conversation = record.value as Conversation;
            if (typeof conversation.id !== 'string' || !['direct', 'note', 'group'].includes(conversation.kind)) throw new Error('invalid archived conversation');
            const existing = await repos.conversation(conversation.id);
            const newer = !existing || existing.lastActivity <= conversation.lastActivity;
            const timer = existing && (existing.expireUpdatedAt ?? 0) >= (conversation.expireUpdatedAt ?? 0) ? {} : { expireSeconds: conversation.expireSeconds, expireUpdatedAt: conversation.expireUpdatedAt };
            const block = existing && (existing.blockedChangedAt ?? 0) >= (conversation.blockedChangedAt ?? 0) ? {} : { blocked: conversation.blocked, blockedChangedAt: conversation.blockedChangedAt };
            if (!await this.store.get(RecordNs.localHiddenConversation, conversation.id)) ops.push(repos.putConversation(existing ? { ...existing, ...(newer ? { title: conversation.title, preview: conversation.preview, lastActivity: conversation.lastActivity, adminOnly: conversation.adminOnly } : {}), ...timer, ...block } : { ...conversation, unread: 0, draft: undefined }));
          } else if (record.kind === 'profile' || record.kind === 'group') {
            const value = record.value as { accountId?: string; groupId?: string };
            const id = record.kind === 'profile' ? value.accountId : value.groupId;
            if (typeof id !== 'string') throw new Error('invalid archive record');
            const existing = await this.store.get<{ updatedAt?: number }>(record.kind, id);
            if (!existing || (record.kind === 'profile' && ((value as { updatedAt?: number }).updatedAt ?? 0) > (existing.updatedAt ?? 0))) ops.push({ type: 'put', ns: record.kind, id, value });
          } else throw new Error('unsupported archive entry');
          cursor = entry.seq;
          ops.push({ type: 'put', ns: 'history-meta', id: 'cursor', value: cursor });
          await this.store.commit(ops, false);
          changed = true;
          });
        }
      }
      if (changed) await this.restored();
      this.status((await this.store.list(PENDING)).length ? 'pending' : 'synced');
    } catch { if (!this.stopped) this.status(navigator.onLine ? 'error' : 'pending'); }
  }
}
