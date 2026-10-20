import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice-note recording with MediaRecorder (UI.md §5.3, FEAT-01). The microphone is requested only
 * when the user presses the record button and released as soon as recording stops.
 */
export type RecorderState = 'idle' | 'recording' | 'paused' | 'denied' | 'unsupported';

/** Maximum voice note length (keeps attachments well under the size limit). */
const MAX_DURATION_MS = 15 * 60 * 1000;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

export interface RecordedVoiceNote {
  file: File;
  durationMs: number;
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timing = useRef({ started: 0, accumulated: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef<((note: RecordedVoiceNote | null) => void) | null>(null);

  const stopTracks = () => {
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const duration = () =>
    timing.current.accumulated + (recorder.current?.state === 'recording' ? Date.now() - timing.current.started : 0);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const type = (rec.mimeType || 'audio/webm').split(';')[0]!;
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const durationMs = timing.current.accumulated;
      const done = finish.current;
      finish.current = null;
      stopTracks();
      setState('idle');
      setElapsed(0);
      done?.(chunks.current.length > 0 ? { file: new File(chunks.current, `voice-note-${Date.now()}.${ext}`, { type }), durationMs } : null);
    };
    recorder.current = rec;
    timing.current = { started: Date.now(), accumulated: 0 };
    rec.start(250);
    setState('recording');
    timer.current = setInterval(() => {
      const d = duration();
      setElapsed(d);
      if (d >= MAX_DURATION_MS) void stop();
    }, 200);
  }, []);

  const pause = useCallback(() => {
    if (recorder.current?.state !== 'recording') return;
    recorder.current.pause();
    timing.current.accumulated += Date.now() - timing.current.started;
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    if (recorder.current?.state !== 'paused') return;
    recorder.current.resume();
    timing.current.started = Date.now();
    setState('recording');
  }, []);

  /** Stops and returns the recording (null if cancelled or empty). */
  const stop = useCallback(
    () =>
      new Promise<RecordedVoiceNote | null>((resolve) => {
        const rec = recorder.current;
        if (!rec || rec.state === 'inactive') return resolve(null);
        timing.current.accumulated = duration();
        finish.current = resolve;
        rec.stop();
      }),
    [],
  );

  /** Discards the recording. */
  const cancel = useCallback(async () => {
    await stop();
  }, [stop]);

  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      finish.current = null;
      recorder.current.stop();
    }
    stopTracks();
  }, []);

  return { state, elapsed, start, pause, resume, stop, cancel, reset: () => setState('idle') };
}

/** `m:ss` duration label. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
