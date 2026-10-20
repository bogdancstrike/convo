/**
 * Minimal typed event emitter used by the core client to notify the UI and by the socket layer.
 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Subscribes to an event; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
    return () => set.delete(listener as (payload: never) => void);
  }

  /** Emits an event synchronously; listener errors are isolated and logged. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        (listener as (p: Events[K]) => void)(payload);
      } catch (error) {
        console.error('Event listener failed', error);
      }
    }
  }
}
