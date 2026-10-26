// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewaySocket, isRevoked, type ConnectionState } from './socket';

/** Minimal scripted WebSocket: tests open, deliver and close it by hand. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: Record<string, unknown>[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string, readonly protocols: string[]) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; this.readyState = FakeWebSocket.CLOSED; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  deliver(frame: unknown) { this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); }
  drop(code = 1006) { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code }); }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
const flush = () => vi.advanceTimersByTimeAsync(0);

function socket(tickets: () => Promise<string> = async () => 't1') {
  const s = new GatewaySocket(tickets, 'wss://convo.test/v1/ws');
  const states: ConnectionState[] = [];
  s.on('state', (state) => states.push(state));
  return { s, states };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('isRevoked', () => {
  it.each([
    [{ code: 'DEVICE_REVOKED' }, true],
    // A disabled account is reversible: the device must keep its keys and history.
    [{ code: 'ACCOUNT_DISABLED' }, false],
    [{ code: 'NONCE_INVALID' }, false],
    [{ code: 'FORBIDDEN' }, false],
    [new Error('offline'), false],
    [null, false],
    [undefined, false],
    ['DEVICE_REVOKED', false],
  ])('%j → %s', (error, expected) => {
    expect(isRevoked(error)).toBe(expected);
  });
});

describe('GatewaySocket', () => {
  it('authenticates with a one-use ticket in the subprotocol list', async () => {
    const { s, states } = socket();
    s.start(); await flush();
    expect(last().protocols).toEqual(['enclave.v1', 'ticket.t1']);
    expect(last().url).toBe('wss://convo.test/v1/ws');
    last().open();
    expect(states).toEqual(['connecting', 'online']);
    expect(s.state).toBe('online');
  });

  it('start is idempotent', async () => {
    const { s } = socket();
    s.start(); s.start(); await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('pings every 30 s while online', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(last().sent.filter((f) => 'ping' in f)).toHaveLength(2);
  });

  it('a revoked device stops for good and never retries', async () => {
    const tickets = vi.fn(async () => { throw Object.assign(new Error('revoked'), { code: 'DEVICE_REVOKED' }); });
    const { s, states } = socket(tickets);
    s.start(); await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states).toEqual(['connecting', 'revoked']);
    expect(tickets).toHaveBeenCalledTimes(1);
  });

  it('a disabled account keeps retrying and comes back when enabled again', async () => {
    let disabled = true;
    const tickets = vi.fn(async () => { if (disabled) throw Object.assign(new Error('disabled'), { code: 'ACCOUNT_DISABLED' }); return 't2'; });
    const { s, states } = socket(tickets);
    s.start(); await flush();
    expect(states).not.toContain('revoked');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tickets.mock.calls.length).toBeGreaterThan(1);
    disabled = false;
    await vi.advanceTimersByTimeAsync(120_000);
    last().open();
    expect(s.state).toBe('online');
    expect(states).not.toContain('revoked');
  });

  it('ticket failures back off but keep trying', async () => {
    const tickets = vi.fn(async () => { throw new Error('network'); });
    const { s } = socket(tickets);
    s.start(); await flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tickets.mock.calls.length).toBeGreaterThan(3);
    // Full jitter, capped at 60 s: never more than ~1 attempt per ms nor fewer than 1 per minute.
    expect(tickets.mock.calls.length).toBeLessThan(10 * 60);
    s.stop();
  });

  it('close code 4401 means revoked', async () => {
    const { s, states } = socket();
    s.start(); await flush(); last().open();
    last().drop(4401);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states[states.length - 1]).toBe('revoked');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('other drops go offline and reconnect', async () => {
    const { s, states } = socket();
    s.start(); await flush(); last().open();
    last().drop(1006);
    expect(states[states.length - 1]).toBe('offline');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('the browser coming online reconnects immediately', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    last().drop(1006);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stop closes the socket cleanly and stops reconnecting', async () => {
    const { s, states } = socket();
    s.start(); await flush(); const ws = last(); ws.open();
    s.stop();
    expect(ws.closed).toEqual({ code: 1000, reason: 'client stop' });
    expect(states[states.length - 1]).toBe('offline');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a ticket arriving after stop opens nothing', async () => {
    let release!: (t: string) => void;
    const { s } = socket(() => new Promise<string>((r) => { release = r; }));
    s.start(); await flush();
    s.stop(); release('late'); await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('send resolves with the matching sendResult', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    const result = s.send({ destination: 'x' } as never);
    const frame = last().sent[0]!;
    expect(frame.send).toEqual({ destination: 'x' });
    last().deliver({ requestId: frame.requestId, sendResult: { serverTimestamp: 7 } });
    await expect(result).resolves.toEqual({ serverTimestamp: 7 });
  });

  it('send rejects with the server error code', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    const result = s.send({} as never);
    last().deliver({ requestId: last().sent[0]!.requestId, error: { code: 'MISMATCHED_DEVICES' } });
    await expect(result).rejects.toThrow('MISMATCHED_DEVICES');
  });

  it('send while offline rejects immediately', async () => {
    const { s } = socket();
    await expect(s.send({} as never)).rejects.toThrow('offline');
  });

  it('send times out after 20 s', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    const result = s.send({} as never);
    const check = expect(result).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(20_000);
    await check;
  });

  it('pending sends fail when the connection drops', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    const result = s.send({} as never);
    const check = expect(result).rejects.toThrow('connection lost');
    last().drop(1006);
    await check;
  });

  it('request ids are unique and increasing', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    void s.send({} as never).catch(() => undefined); void s.send({} as never).catch(() => undefined);
    const [a, b] = last().sent.map((f) => f.requestId as number);
    expect(b).toBeGreaterThan(a!);
    s.stop();
  });

  it('ack sends guids fire-and-forget, and nothing for an empty list', async () => {
    const { s } = socket();
    s.start(); await flush(); last().open();
    s.ack([]); s.ack(['g1', 'g2']);
    expect(last().sent).toEqual([{ requestId: 0, ack: { guids: ['g1', 'g2'] } }]);
  });

  it('emits envelopes, queue-empty and directives', async () => {
    const { s } = socket();
    const seen: string[] = [];
    s.on('envelope', (e) => seen.push(`env:${(e as { guid: string }).guid}`));
    s.on('queueEmpty', () => seen.push('empty'));
    s.on('directive', (d) => seen.push(`dir:${d}`));
    s.start(); await flush(); last().open();
    last().deliver({ envelope: { guid: 'g1' } });
    last().deliver({ queueEmpty: {} });
    last().deliver({ directive: { type: 'REVOKED' } });
    expect(seen).toEqual(['env:g1', 'empty', 'dir:REVOKED']);
  });

  it.each([
    ['not json', '{'],
    ['binary', new ArrayBuffer(4)],
    ['unknown frame', { surprise: true }],
    ['reply to no request', { requestId: 999, sendResult: {} }],
  ])('ignores %s frames', async (_name, frame) => {
    const { s } = socket();
    const seen: unknown[] = [];
    s.on('envelope', (e) => seen.push(e)); s.on('directive', (d) => seen.push(d));
    s.start(); await flush(); last().open();
    if (frame instanceof ArrayBuffer) last().onmessage?.({ data: frame }); else last().deliver(frame);
    expect(seen).toEqual([]);
    expect(s.state).toBe('online');
  });

  it('a stale socket closing does not affect the current one', async () => {
    const { s } = socket();
    s.start(); await flush(); const first = last(); first.open();
    first.drop(1006); await vi.advanceTimersByTimeAsync(2_000);
    const second = last(); second.open();
    first.onclose?.({ code: 1006 });
    expect(s.state).toBe('online');
  });
});
