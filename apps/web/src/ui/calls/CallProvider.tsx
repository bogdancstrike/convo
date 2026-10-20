import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RING_TIMEOUT_MS, type CallInvite } from '../../core/calls';
import type { EnclaveClient } from '../../core/client';
import { CallEncryptionUnsupportedError } from './errors';
import type { LiveKitCall } from './liveKitCall';

// LiveKit (SFU client + E2EE worker) loads only when a call starts.
const CallScreen = lazy(() => import('./CallScreen').then((m) => ({ default: m.CallScreen })));
import { Ringer } from './ringer';

export type CallPhase = 'incoming' | 'outgoing' | 'connecting' | 'connected' | 'ended';
export type CallEndReason = 'declined' | 'busy' | 'noAnswer' | 'ended' | 'failed' | 'unsupported' | 'answeredElsewhere';

export interface ActiveCall {
  callId?: string;
  conversationId: string;
  video: boolean;
  direction: 'in' | 'out';
  phase: CallPhase;
  invite?: CallInvite;
  connectedAt?: number;
  reason?: CallEndReason;
}

interface CallControls {
  call: ActiveCall | null;
  media: LiveKitCall | null;
  start: (conversationId: string, video: boolean) => void;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  /** Re-render tick for media state changes (tracks, mute, speakers). */
  version: number;
}

const Calls = createContext<CallControls | null>(null);
export function useCalls(): CallControls {
  const value = useContext(Calls);
  if (!value) throw new Error('useCalls outside CallProvider');
  return value;
}

/**
 * Owns at most one call at a time: ringing (in/out), LiveKit connection and teardown. Incoming
 * rings while busy are answered with `busy`. The UI is a full-window dialog above the app.
 */
export function CallProvider({ client, children }: { client: EnclaveClient; children: ReactNode }) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [version, setVersion] = useState(0);
  const media = useRef<LiveKitCall | null>(null);
  const current = useRef<ActiveCall | null>(null);
  const ringer = useRef(new Ringer());
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const update = useCallback((next: ActiveCall | null) => { current.current = next; setCall(next); }, []);
  const patch = useCallback((p: Partial<ActiveCall>) => { if (current.current) update({ ...current.current, ...p }); }, [update]);

  const finish = useCallback(async (reason: CallEndReason) => {
    ringer.current.stop();
    const leaving = media.current; media.current = null;
    await leaving?.leave();
    patch({ phase: 'ended', reason });
    setTimeout(() => { if (current.current?.phase === 'ended') update(null); }, 1800);
  }, [patch, update]);

  const onMediaChange = useCallback(() => {
    bump();
    const active = current.current;
    if (!active || !media.current) return;
    const others = media.current.remotes.length;
    if (others > 0 && active.phase !== 'connected') { ringer.current.stop(); patch({ phase: 'connected', connectedAt: Date.now() }); }
    // Direct call: the other side left. Group call: stay until the user hangs up.
    if (others === 0 && active.phase === 'connected' && !client.conversations().find((c) => c.id === active.conversationId && c.kind === 'group')) {
      patch({ phase: 'ended', reason: 'ended' });
      void client.endCall(active.callId!, active.conversationId, true).catch(() => undefined);
      void finish('ended');
    }
  }, [bump, client, finish, patch]);

  const connect = useCallback(async (join: Parameters<LiveKitCall['connect']>[0], key: string, video: boolean) => {
    const { LiveKitCall } = await import('./liveKitCall');
    const lk = new LiveKitCall(onMediaChange);
    media.current = lk;
    await lk.connect(join, key, video);
    onMediaChange();
  }, [onMediaChange]);

  const start = useCallback((conversationId: string, video: boolean) => {
    if (current.current) return;
    update({ conversationId, video, direction: 'out', phase: 'outgoing' });
    void (async () => {
      try {
        const { join, key } = await client.startCall(conversationId, video);
        patch({ callId: join.callId });
        ringer.current.start('outgoing');
        await connect(join, key, video);
        setTimeout(() => {
          const active = current.current;
          if (active?.callId === join.callId && active.phase === 'outgoing') void client.endCall(join.callId, conversationId, false).finally(() => void finish('noAnswer'));
        }, RING_TIMEOUT_MS);
      } catch (e) {
        const id = current.current?.callId;
        if (id) await client.endCall(id, conversationId, false).catch(() => undefined);
        void finish(e instanceof CallEncryptionUnsupportedError ? 'unsupported' : 'failed');
      }
    })();
  }, [client, connect, finish, patch, update]);

  const accept = useCallback(() => {
    const active = current.current;
    if (!active?.invite || active.phase !== 'incoming') return;
    ringer.current.stop();
    patch({ phase: 'connecting' });
    void (async () => {
      try { await connect(await client.answerCall(active.invite!), active.invite!.key, active.invite!.video); }
      catch (e) { void finish(e instanceof CallEncryptionUnsupportedError ? 'unsupported' : 'failed'); }
    })();
  }, [client, connect, finish, patch]);

  const decline = useCallback(() => {
    const active = current.current;
    if (!active?.invite) return;
    void client.declineCall(active.invite);
    void finish('declined');
  }, [client, finish]);

  const hangUp = useCallback(() => {
    const active = current.current;
    if (!active) return;
    if (active.phase === 'incoming') { decline(); return; }
    if (active.callId) void client.endCall(active.callId, active.conversationId, active.phase === 'connected');
    void finish('ended');
  }, [client, decline, finish]);

  useEffect(() => client.on('call', (event) => {
    const active = current.current;
    if (event.type === 'incoming') {
      if (active && active.phase !== 'ended') { void client.declineCall(event.invite, true); return; }
      update({ callId: event.invite.callId, conversationId: event.invite.conversationId, video: event.invite.video, direction: 'in', phase: 'incoming', invite: event.invite });
      ringer.current.start('incoming');
      const deadline = event.invite.at + RING_TIMEOUT_MS - Date.now();
      setTimeout(() => {
        if (current.current?.callId === event.invite.callId && current.current.phase === 'incoming') { void client.missCall(event.invite); void finish('noAnswer'); }
      }, Math.max(1000, deadline));
      return;
    }
    if (!active || active.callId !== event.callId || active.phase === 'ended') return;
    const group = active.conversationId.startsWith('g:');
    if (event.fromSelf && active.phase === 'incoming') { void finish('answeredElsewhere'); return; }
    if (event.action === 'decline' && !group) void finish('declined');
    else if (event.action === 'busy' && !group) void finish('busy');
    else if (event.action === 'cancel' || (event.action === 'end' && !group)) void finish('ended');
  }), [client, finish, update]);

  useEffect(() => () => { ringer.current.stop(); void media.current?.leave(); }, []);

  return (
    <Calls.Provider value={{ call, media: media.current, start, accept, decline, hangUp, version }}>
      {children}
      {call && <Suspense fallback={null}><CallScreen client={client} /></Suspense>}
    </Calls.Provider>
  );
}
