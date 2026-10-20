/**
 * Cross-tab exclusion (specs §28, WEB-01 "bounded cross-tab coordination"). Only one tab may run
 * the protocol client at a time; otherwise two tabs would race on ratchet state.
 *
 * Uses the Web Locks API. The lock is held until {@link LeaderLock.release} or the tab closes.
 */
export class LeaderLock {
  private releaseLock: (() => void) | null = null;

  /**
   * Tries to become the active tab.
   *
   * @param steal take over from another tab (the other tab loses its lock and must stop)
   * @param onLost called if another tab later steals leadership from this one
   * @returns whether this tab is now the leader
   */
  async acquire(steal = false, onLost: () => void = () => undefined): Promise<boolean> {
    if (!('locks' in navigator)) return true; // very old browsers: best effort
    return new Promise<boolean>((resolve) => {
      void navigator.locks
        .request('enclave-protocol-leader', steal ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        })
        .then(
          () => undefined,
          () => {
            // Rejected after acquisition means another tab stole the lock.
            if (this.releaseLock) {
              this.releaseLock = null;
              onLost();
            } else {
              resolve(false);
            }
          },
        );
    });
  }

  /** Releases leadership. */
  release(): void {
    this.releaseLock?.();
    this.releaseLock = null;
  }
}
