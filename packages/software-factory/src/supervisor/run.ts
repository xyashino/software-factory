import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nextAction } from '../engine/next-action';
import { reduce } from '../engine/reduce';
import type { TaskState } from '../engine/state';
import type { TaskRow } from '../ports/store.port';
import { supervisorLogPath } from '../paths';
import { plainPaint, type Paint } from '../paint';
import { transitionLines } from './console-lines';
import { execute } from './execute';
import { forgetHeartbeat } from './observe';
import { taskContext } from './task-context';
import { pickTodo } from './pick-todo';
import { reconcile, reconcileTask } from './reconcile';
import type { SupervisorPorts } from './ports';

/**
 * A task in any of these statuses holds the line: nothing else is picked.
 * `parked` and `queued` tasks wait off the line.
 */
export const ACTIVE_STATUSES = [
  'setting_up',
  'running',
  'waiting',
  'blocked',
  'delivering',
] as const;

/** Pause between ticks when there is no todo to run. */
export const NO_WORK_MS = 30_000;
/** Pause between ticks when the active task is waiting on something. */
export const IDLE_MS = 2_000;

export interface RunOptions {
  signal: AbortSignal;
  log: (line: string) => void;
  /** styling for console lines; default plain */
  paint?: Paint;
  /** test seam: the pause between ticks; default honours `signal` */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Waits `ms`, or returns early when the signal aborts. */
export const sleepUnlessAborted = (
  ms: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
};

export const appendSupervisorLog = (
  root: string,
  taskId: string,
  line: string,
): void => {
  try {
    const logPath = supervisorLogPath(root, taskId);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // cosmetic
  }
};

export const appendGlobalSupervisorLog = (root: string, line: string): void => {
  try {
    const dir = join(root, '.factory');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'supervisor.log'), `${line}\n`);
  } catch {
    // cosmetic
  }
};

/**
 * The supervisor: reconcile once, then loop until the signal aborts. Each tick
 * picks a todo when nothing is active, performs the engine's next action for the
 * active task, and records the task's status.
 */
export const runSupervisor = async (
  ports: SupervisorPorts,
  options: RunOptions,
): Promise<void> => {
  const sleep = options.sleep ?? sleepUnlessAborted;
  await reconcile(ports);
  while (!options.signal.aborted) {
    const pause = await tick(ports, options.log, options.paint);
    await sleep(pause, options.signal);
  }
  options.log('supervisor stopped');
};

/** One pass of the loop. Returns how long to pause before the next pass. */
export const tick = async (
  ports: SupervisorPorts,
  log: (line: string) => void,
  paint: Paint = plainPaint,
): Promise<number> => {
  const active = ports.store.tasks({ status: [...ACTIVE_STATUSES] });
  let taskId: string | undefined;
  if (active.length > 0) {
    taskId = oldest(active).id;
  } else {
    taskId = await startNextTask(ports, log);
    if (taskId === undefined) return NO_WORK_MS;
  }

  const taskLog = (line: string): void => {
    log(line);
    // ANSI stays: `tail -f` in a terminal pane renders the colours
    appendGlobalSupervisorLog(ports.root, line);
    if (taskId !== undefined) {
      appendSupervisorLog(ports.root, taskId, line);
    }
  };

  try {
    const { workflow } = taskContext(ports, taskId);
    const before = reduce(workflow, ports.store.events(taskId));
    const action = nextAction(workflow, before);
    await execute(ports, taskId, action, taskLog, paint);
    let after = reduce(workflow, ports.store.events(taskId));
    // A final block (no operator left to triage it) releases the line.
    if (
      after.status === 'blocked' &&
      nextAction(workflow, after).type === 'idle'
    ) {
      ports.store.append(taskId, { type: 'parked' });
      after = reduce(workflow, ports.store.events(taskId));
    }
    for (const line of transitionLines({
      before,
      after,
      workflow,
      roles: ports.definitions.roles,
      taskId,
      now: ports.clock.now(),
      paint: paint,
    })) {
      taskLog(line);
    }
    ports.store.setTaskStatus(taskId, after.status);
    await closeFinishedTabs(ports, taskId, after, taskLog);
    if (action.type === 'idle' || action.type === 'block') return IDLE_MS;
    return 0;
  } catch (error) {
    // An unexpected failure parks the task for a human; the loop itself keeps going.
    const detail = error instanceof Error ? error.message : String(error);
    ports.store.append(taskId, { type: 'blocked', reason: 'infra', detail });
    ports.store.setTaskStatus(taskId, 'blocked');
    taskLog(`${taskId}: blocked (infra): ${detail}`);
    return IDLE_MS;
  }
};

/**
 * With nothing active: a queued task resumes first; otherwise the next todo is
 * picked. Returns the started task's id.
 */
const startNextTask = async (
  ports: SupervisorPorts,
  log: (line: string) => void,
): Promise<string | undefined> => {
  const queued = ports.store.tasks({ status: ['queued'] })[0];
  if (queued !== undefined) {
    await reconcileTask(ports, queued.id);
    ports.store.setTaskStatus(queued.id, 'running');
    log(`resumed unblocked task ${queued.id}`);
    return queued.id;
  }

  if (breakerTripped(ports.store.tasks())) {
    if (!breakerLogged.has(ports)) log(BREAKER_LINE);
    breakerLogged.add(ports);
    return undefined;
  }
  breakerLogged.delete(ports);

  const scan = pickTodo(
    ports.root,
    ports.store.tasks(),
    new Set(ports.definitions.workflows.keys()),
  );
  for (const reason of scan.skipped) {
    log(`skipped ${reason}`);
    appendGlobalSupervisorLog(ports.root, `skipped ${reason}`);
  }
  if (scan.pick === undefined) return undefined;
  const branch = `factory/${scan.pick.taskId}`;
  ports.store.createTask({
    taskId: scan.pick.taskId,
    workflow: scan.pick.workflow,
    todoPath: scan.pick.todoPath,
    branch,
  });
  ports.store.append(scan.pick.taskId, {
    type: 'task_created',
    workflow: scan.pick.workflow,
    todoPath: scan.pick.todoPath,
    branch,
  });
  const pickMsg = `picked ${scan.pick.todoPath} as task ${scan.pick.taskId}`;
  log(pickMsg);
  appendGlobalSupervisorLog(ports.root, pickMsg);
  appendSupervisorLog(ports.root, scan.pick.taskId, pickMsg);
  return scan.pick.taskId;
};

/** Consecutive parked tasks that stop the supervisor from picking new todos. */
export const BREAKER_LIMIT = 3;
const BREAKER_LINE = `[CIRCUIT BREAKER] ${BREAKER_LIMIT} consecutive tasks parked. Pausing supervisor loop.`;
/** The breaker line is logged once per trip, not on every tick. */
const breakerLogged = new WeakSet<SupervisorPorts>();

/**
 * True when the newest tasks, back to the last delivered one, are all parked.
 * `sf unblock` turns a parked task into a queued one, which resumes the loop.
 */
export const breakerTripped = (tasks: readonly TaskRow[]): boolean => {
  let parked = 0;
  for (const task of [...tasks].reverse()) {
    if (task.status !== 'parked') break;
    parked += 1;
  }
  return parked >= BREAKER_LIMIT;
};

/** The earliest-created active task; there is normally only one. */
const oldest = (tasks: readonly TaskRow[]): TaskRow => {
  return tasks.reduce((first, row) =>
    row.createdAt < first.createdAt ? row : first,
  );
};

/**
 * Closes the tab of every finished attempt. A blocked or parked task keeps
 * its tabs open so a human can look at them.
 */
const closeFinishedTabs = async (
  ports: SupervisorPorts,
  taskId: string,
  state: TaskState,
  log: (line: string) => void,
): Promise<void> => {
  if (state.status === 'blocked' || state.status === 'parked') return;
  const tabs = new Map<string, string>();
  for (const stored of ports.store.events(taskId)) {
    if (stored.event.type === 'agent_ready') {
      tabs.set(stored.event.attemptId, stored.event.tab);
    }
  }
  for (const attempt of state.attempts) {
    const tab = tabs.get(attempt.attemptId);
    const finished =
      attempt.status === 'completed' ||
      attempt.status === 'passed' ||
      attempt.status === 'failed';
    if (finished) forgetHeartbeat(attempt.attemptId);
    // A headless attempt records an empty tab: there is nothing to close.
    if (tab !== undefined && tab !== '' && finished && !closedTabs.has(tab)) {
      closedTabs.add(tab);
      try {
        await ports.herdr.closeTab(tab);
      } catch (error) {
        // A tab that cannot be closed stays open; that is cosmetic, not a task failure.
        log(
          `could not close tab ${tab}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
};

/** Tabs already closed by this process; closing again would only report absent. */
const closedTabs = new Set<string>();
