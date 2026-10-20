import { ApiError, NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import type { GatewaySocket } from '../api/socket';
import type { SendRequestDto, SendResultDto } from '../api/types';
import { CONTENT_VERSION, encodeContent, type Content } from '../crypto/content';
import { randomBytes, toBase64Url } from '../lib/bytes';
import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import { RecordNs } from './repositories';
import { UntrustedIdentityError, type SessionManager } from './sessions';

/**
 * Durable outbox (specs §26.1 client states, UI.md §5.2).
 *
 * Lifecycle: `queued` → (encrypt; ciphertext + ratchet state persisted atomically) `ready` →
 * submit → accepted. After an uncertain transport outcome the **same stored ciphertext and
 * submission ID** are retried, so the server deduplicates. Only a definitive device-list rejection
 * discards a ciphertext and re-encrypts with a new submission ID.
 */

export type OutboxState = 'queued' | 'ready' | 'blocked' | 'failed';

/** One built submission to a single destination account. */
export interface PreparedSubmission {
  target: string;
  request: SendRequestDto;
  accepted: boolean;
}

export interface OutboxItem {
  id: string;
  createdAt: number;
  /** Peer (or own) account the content is addressed to. */
  destination: string;
  /** Content for the destination's devices. */
  content: Content;
  /** Mirror a `sync.sent` transcript to the sender's other devices. */
  syncTranscript: boolean;
  /** Link to the local message whose status this item drives. */
  message?: { conversationId: string; id: string };
  transientTtlSeconds: number;
  state: OutboxState;
  submissions: PreparedSubmission[];
  attempts: number;
  /** Targets still to be built. Initially destination (+ self for transcripts). */
  pendingTargets: string[];
  error?: string;
}

/** Outcome notifications so the client can update message status. */
export interface OutboxListener {
  onAccepted(item: OutboxItem): Promise<void>;
  onFailed(item: OutboxItem, reason: 'failed' | 'blocked', error: unknown): Promise<void>;
}

const MAX_ATTEMPTS = 6;

export class Outbox {
  private running = false;
  private rerun = false;

  constructor(
    private readonly store: EncryptedStore,
    private readonly sessions: SessionManager,
    private readonly api: EnclaveApi,
    private readonly socket: GatewaySocket,
    private readonly selfAccountId: string,
    private readonly listener: OutboxListener,
    private readonly runExclusive: <T>(task: () => Promise<T>) => Promise<T>,
  ) {}

  /** Creates an outbox item; persist the returned op together with the local message. */
  static create(params: {
    destination: string;
    content: Content;
    selfAccountId: string;
    syncTranscript: boolean;
    message?: { conversationId: string; id: string };
    transientTtlSeconds?: number;
  }): OutboxItem {
    const targets = [];
    if (params.destination !== params.selfAccountId) targets.push(params.destination);
    if (params.syncTranscript || params.destination === params.selfAccountId) targets.push(params.selfAccountId);
    return {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      destination: params.destination,
      content: params.content,
      syncTranscript: params.syncTranscript,
      message: params.message,
      transientTtlSeconds: params.transientTtlSeconds ?? 0,
      state: 'queued',
      submissions: [],
      attempts: 0,
      pendingTargets: targets,
    };
  }

  static op(item: OutboxItem): StoreOp {
    return { type: 'put', ns: RecordNs.outbox, id: item.id, value: item };
  }

  /** Processes queued items; concurrent calls coalesce into one extra pass. */
  async flush(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const items = (await this.store.list<OutboxItem>(RecordNs.outbox))
          .filter((i) => i.state === 'queued' || i.state === 'ready')
          .sort((a, b) => a.createdAt - b.createdAt);
        for (const item of items) {
          const progressed = await this.runExclusive(() => this.process(item));
          if (!progressed) break; // offline: keep order, retry later
        }
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  /** @returns false when processing must pause (offline / transient failure). */
  private async process(item: OutboxItem): Promise<boolean> {
    try {
      await this.build(item);
      for (const submission of item.submissions.filter((s) => !s.accepted)) {
        const result = await this.submit(submission.request);
        if (result.ok) {
          submission.accepted = true;
          await this.store.put(RecordNs.outbox, item.id, item);
          continue;
        }
        await this.handleRejection(item, submission, result);
        return true;
      }
      if (item.pendingTargets.length === 0 && item.submissions.every((s) => s.accepted)) {
        await this.store.delete(RecordNs.outbox, item.id);
        await this.listener.onAccepted(item);
      }
      return true;
    } catch (error) {
      if (error instanceof NetworkError || isTransient(error)) return false;
      if (error instanceof UntrustedIdentityError) {
        await this.finish(item, 'blocked', error);
        return true;
      }
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') return false;
      await this.finish(item, 'failed', error);
      return true;
    }
  }

  /** Encrypts content for every pending target and persists ciphertext + protocol state. */
  private async build(item: OutboxItem): Promise<void> {
    while (item.pendingTargets.length > 0) {
      const target = item.pendingTargets[0]!;
      const content: Content =
        target === item.destination
          ? item.content
          : item.content.kind === 'data'
            ? { v: CONTENT_VERSION, kind: 'sync', sync: { sent: { destination: item.destination, data: item.content.data } } }
            : item.content;
      const fanout = await this.sessions.encryptForAccount(target, encodeContent(content));
      if (fanout.messages.length === 0 && target !== this.selfAccountId) {
        throw new ApiError(404, 'NOT_FOUND', 'recipient has no active devices');
      }
      item.pendingTargets.shift();
      if (fanout.messages.length > 0) {
        item.submissions.push({
          target,
          accepted: false,
          request: {
            destination: target,
            submissionId: toBase64Url(randomBytes(16)),
            messages: fanout.messages,
            urgent: false,
            transientTtlSeconds: item.transientTtlSeconds,
          },
        });
      }
      item.state = 'ready';
      await this.store.commit([...fanout.ops, Outbox.op(item)]);
    }
  }

  private async submit(request: SendRequestDto): Promise<SendResultDto> {
    if (this.socket.state === 'online') {
      try {
        return await this.socket.send(request);
      } catch (error) {
        throw new NetworkError(error); // outcome unknown: retry the same submission later
      }
    }
    try {
      return await this.api.send(request);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'DEVICE_MISMATCH' || error.code === 'STALE_DEVICES')) {
        return {
          ok: false,
          errorCode: error.code,
          missingDevices: error.problem.missing as number[] | undefined,
          extraDevices: error.problem.extra as number[] | undefined,
          staleDevices: error.problem.stale as number[] | undefined,
        };
      }
      throw error;
    }
  }

  /** Device-list rejections: drop affected sessions, discard the ciphertext and rebuild. */
  private async handleRejection(item: OutboxItem, submission: PreparedSubmission, result: SendResultDto): Promise<void> {
    if (result.errorCode !== 'DEVICE_MISMATCH' && result.errorCode !== 'STALE_DEVICES') {
      throw new ApiError(409, result.errorCode ?? 'UNKNOWN', 'send rejected');
    }
    item.attempts += 1;
    if (item.attempts > MAX_ATTEMPTS) throw new ApiError(409, result.errorCode, 'device list did not converge');
    await this.sessions.dropSessions(submission.target, [...(result.extraDevices ?? []), ...(result.staleDevices ?? [])]);
    item.submissions = item.submissions.filter((s) => s !== submission);
    item.pendingTargets.unshift(submission.target);
    await this.store.put(RecordNs.outbox, item.id, item);
    this.rerun = true;
  }

  private async finish(item: OutboxItem, state: 'failed' | 'blocked', error: unknown): Promise<void> {
    item.state = state;
    item.error = error instanceof Error ? error.message : String(error);
    await this.store.put(RecordNs.outbox, item.id, item);
    await this.listener.onFailed(item, state, error);
  }

  /** Re-queues a failed/blocked item (user tapped Retry). */
  async retry(itemId: string): Promise<void> {
    const item = await this.store.get<OutboxItem>(RecordNs.outbox, itemId);
    if (!item) return;
    item.state = item.submissions.length > 0 || item.pendingTargets.length === 0 ? 'ready' : 'queued';
    item.attempts = 0;
    item.error = undefined;
    await this.store.put(RecordNs.outbox, item.id, item);
    await this.flush();
  }

  /** Finds the outbox item driving a local message. */
  async findByMessage(conversationId: string, messageId: string): Promise<OutboxItem | undefined> {
    return (await this.store.list<OutboxItem>(RecordNs.outbox)).find(
      (i) => i.message?.conversationId === conversationId && i.message.id === messageId,
    );
  }
}

function isTransient(error: unknown): boolean {
  return error instanceof ApiError && (error.status >= 500 || error.status === 429);
}
