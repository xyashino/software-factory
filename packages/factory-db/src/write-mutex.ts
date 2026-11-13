/** Runs async sections one at a time, in arrival order (STORAGE §3.1). */
export interface WriteMutex {
  run<T>(section: () => Promise<T>): Promise<T>;
}

export const writeMutex = (): WriteMutex => {
  // Never rejects: a failed section must not block the sections queued behind it.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: (section) => {
      const result = tail.then(() => section());
      tail = result.catch(() => undefined);
      return result;
    },
  };
};
