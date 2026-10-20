/**
 * Ring tones generated with Web Audio (no audio assets, nothing fetched). Browsers may block sound
 * until the page has had a user gesture; the visual ring UI works regardless.
 */
export class Ringer {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(kind: 'incoming' | 'outgoing'): void {
    this.stop();
    try {
      this.context = new AudioContext();
      const beep = () => {
        const ctx = this.context;
        if (!ctx) return;
        const tones = kind === 'incoming' ? [[880, 0], [660, 0.25], [880, 0.5]] : [[440, 0]];
        for (const [frequency, offset] of tones) {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.frequency.value = frequency!; gain.gain.value = kind === 'incoming' ? 0.08 : 0.04;
          osc.connect(gain).connect(ctx.destination);
          const at = ctx.currentTime + offset!;
          osc.start(at); osc.stop(at + (kind === 'incoming' ? 0.2 : 1.2));
        }
      };
      beep();
      this.timer = setInterval(beep, kind === 'incoming' ? 2000 : 4000);
    } catch { this.stop(); }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
