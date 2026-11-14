/**
 * Runs the sections of one Work order one at a time, in arrival order, inside this process
 * (STORAGE §3.1). Different orders run in parallel. A key's chain is dropped once it is idle.
 */
export interface OrderLocks {
  run<T>(key: string, section: () => Promise<T>): Promise<T>;
}

export const orderLocks = (): OrderLocks => {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run: <T>(key: string, section: () => Promise<T>): Promise<T> => {
      const previous = tails.get(key) ?? Promise.resolve();
      const current = previous.then(section);
      // A failed section must not block the sections queued behind it.
      const settled = current.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) tails.delete(key);
      });
      return current;
    },
  };
};
