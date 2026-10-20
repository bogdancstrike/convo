import { Emitter } from '../lib/emitter';
import type { Directive, EnvelopeDto, SendRequestDto, SendResultDto, ServerFrame } from './types';

/**
 * Resilient device WebSocket (specs §9.2–9.3).
 *
 * - Authenticates each connection with a fresh one-use ticket (`Sec-WebSocket-Protocol`).
 * - Sends `ping` every {@link PING_INTERVAL_MS}; the server re-checks the mailbox on each ping.
 * - Reconnects with exponential backoff and full jitter (1 s → 60 s).
 * - Close code 4401 (revoked) stops reconnecting and emits `revoked`.
 */

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'revoked';

export interface SocketEvents extends Record<string, unknown> {
  state: ConnectionState;
  envelope: EnvelopeDto;
  queueEmpty: undefined;
  directive: Directive;
}

const PING_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const CLOSE_REVOKED = 4401;

interface Pending {
  resolve: (frame: ServerFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GatewaySocket extends Emitter<SocketEvents> {
  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private current: ConnectionState = 'offline';

  /**
   * @param ticketProvider obtains a one-use ticket (device-signed REST call)
   * @param url WebSocket URL; defaults to same-origin `/v1/ws`
   */
  constructor(
    private readonly ticketProvider: () => Promise<string>,
    private readonly url: string = defaultSocketUrl(),
  ) {
    super();
  }

  get state(): ConnectionState {
    return this.current;
  }

  /** Starts connecting and keeps the connection alive until {@link stop}. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener('online', this.onBrowserOnline);
    void this.connect();
  }

  /** Closes the connection and stops reconnecting. */
  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.onBrowserOnline);
    this.clearTimers();
    this.ws?.close(1000, 'client stop');
    this.ws = null;
    this.setState('offline');
  }

  /** Submits a send request and resolves with its result. Rejects if the socket drops. */
  async send(request: SendRequestDto): Promise<SendResultDto> {
    const frame = await this.request({ send: request });
    if (frame.sendResult) return frame.sendResult;
    throw new Error(frame.error?.code ?? 'unexpected response');
  }

  /** Acknowledges persisted envelopes (fire-and-forget; unacked envelopes are redelivered). */
  ack(guids: string[]): void {
    if (guids.length > 0) this.write({ requestId: 0, ack: { guids } });
  }

  private request(body: Record<string, unknown>): Promise<ServerFrame> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('offline'));
    const requestId = this.nextRequestId++;
    return new Promise<ServerFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.write({ requestId, ...body });
    });
  }

  private write(frame: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState('connecting');
    let ticket: string;
    try {
      ticket = await this.ticketProvider();
    } catch (error) {
      if (isRevoked(error)) {
        this.setState('revoked');
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    const ws = new WebSocket(this.url, ['enclave.v1', `ticket.${ticket}`]);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState('online');
      this.pingTimer = setInterval(() => this.write({ requestId: this.nextRequestId++, ping: {} }), PING_INTERVAL_MS);
    };
    ws.onmessage = (event) => this.onFrame(event.data);
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.failPending();
      if (event.code === CLOSE_REVOKED) {
        this.stopped = true;
        this.setState('revoked');
        return;
      }
      this.setState('offline');
      this.scheduleReconnect();
    };
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    if (frame.envelope) {
      this.emit('envelope', frame.envelope);
    } else if (frame.queueEmpty) {
      this.emit('queueEmpty', undefined);
    } else if (frame.directive) {
      this.emit('directive', frame.directive.type);
    } else if (frame.requestId) {
      const pending = this.pending.get(frame.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.requestId);
        pending.resolve(frame);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt++);
    const delay = Math.random() * ceiling;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private readonly onBrowserOnline = (): void => {
    if (this.current === 'offline' && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempt = 0;
      void this.connect();
    }
  };

  private failPending(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('connection lost'));
    }
    this.pending.clear();
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private setState(state: ConnectionState): void {
    if (this.current !== state) {
      this.current = state;
      this.emit('state', state);
    }
  }
}

function defaultSocketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/v1/ws`;
}

function isRevoked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'DEVICE_REVOKED';
}
