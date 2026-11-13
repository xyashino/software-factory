import { SqliteStore } from '../adapters/store/sqlite-store';
import { systemClock } from '../adapters/clock/system-clock';
import { storePath } from '../paths';
import { resolveCaller, CallerError, type Caller } from './caller';
import { loadShippedDefinitions } from '../supervisor/wire';
import { colorPaint } from '../paint';

/**
 * Runs an in-pane command with the caller resolved from the environment. A
 * refusal prints its message and exits 1. The store is closed afterwards.
 */
export const withCaller = async (
  run: (caller: Caller) => void,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> => {
  const root = env.FACTORY_ROOT;
  let store: SqliteStore | undefined;
  try {
    if (!root) {
      throw new CallerError(
        'not inside an active software-factory agent pane: FACTORY_ROOT is not set',
      );
    }
    store = new SqliteStore({ path: storePath(root), clock: systemClock });
    const caller = resolveCaller(env, store, loadShippedDefinitions());
    run(caller);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${colorPaint.red('sf:')} ${message}`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
};
