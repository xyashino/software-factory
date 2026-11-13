import { existsSync } from 'node:fs';
import { SqliteStore } from '../adapters/store/sqlite-store';
import { systemClock } from '../adapters/clock/system-clock';
import { storePath } from '../paths';
import type { StorePort } from '../ports/store.port';

/**
 * Opens the store for reading. A missing store is not an error for a board:
 * it means no task has ever run, so the caller sees an empty store.
 */
export const openReadOnlyStore = (
  root: string,
): {
  store: StorePort;
  close: () => void;
} => {
  const path = storePath(root);
  if (!existsSync(path)) {
    return { store: emptyStore(), close: () => undefined };
  }
  const store = new SqliteStore({ path, clock: systemClock });
  return { store, close: () => store.close() };
};

const emptyStore = (): StorePort => {
  const none = (): never => {
    throw new Error('no store yet');
  };
  return {
    createTask: none,
    append: none,
    events: () => [],
    eventsSince: () => [],
    tasks: () => [],
    setTaskStatus: none,
    runningAttempt: () => undefined,
  };
};
