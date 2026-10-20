/**
 * Promise-based mutex. Serializes protocol-state writers inside one tab (specs §24.3 "serialize
 * protocol writers"); cross-tab exclusion is handled by the leader lock in `core/leader.ts`.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `task` after all previously queued tasks completed. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
