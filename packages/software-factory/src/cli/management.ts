import { SqliteStore } from '../adapters/store/sqlite-store';
import { systemClock } from '../adapters/clock/system-clock';
import type { Workflow } from '../definitions/types';
import { reduce } from '../engine/reduce';
import type { TaskState } from '../engine/state';
import type { StorePort } from '../ports/store.port';
import { storePath } from '../paths';
import { loadShippedDefinitions, resolveRoot } from '../supervisor/wire';
import { CallerError } from './caller';

/** A task as seen from any shell: no pane, no attempt, just the task id. */
export interface TaskHandle {
  taskId: string;
  workflow: Workflow;
  state: TaskState;
  store: StorePort;
  /** `operator` when the shell is the operator's pane, else `human` */
  actor: 'operator' | 'human';
}

/** Reads the task's current state from the store. */
export const openTask = (
  store: StorePort,
  taskId: string,
  env: Readonly<Record<string, string | undefined>>,
  workflows: ReadonlyMap<string, Workflow>,
): TaskHandle => {
  const row = store.tasks().find((task) => task.id === taskId);
  if (row === undefined) throw new CallerError(`task ${taskId} is not known`);
  const workflow = workflows.get(row.workflow);
  if (workflow === undefined) {
    throw new CallerError(`workflow "${row.workflow}" is not defined`);
  }
  const state = reduce(workflow, store.events(taskId));
  const operatorAttempt = state.operator?.attemptId;
  const actor =
    operatorAttempt !== undefined &&
    env.FACTORY_TASK === taskId &&
    env.FACTORY_ATTEMPT === operatorAttempt
      ? 'operator'
      : 'human';
  return { taskId, workflow, state, store, actor };
};

/**
 * Runs a management command from any shell. A refusal prints its message and
 * exits 1. The store is closed afterwards.
 */
export const withTask = async (
  taskId: string,
  run: (task: TaskHandle) => string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> => {
  let store: SqliteStore | undefined;
  try {
    const root = resolveRoot(process.cwd(), env);
    store = new SqliteStore({ path: storePath(root), clock: systemClock });
    const definitions = loadShippedDefinitions();
    const task = openTask(store, taskId, env, definitions.workflows);
    console.log(run(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`sf: ${message}`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
};
