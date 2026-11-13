import type { FactoryEvent } from '../engine/events';
import { reduce } from '../engine/reduce';
import { HEADLESS_PANE_PREFIX } from './headless';
import { agentName } from './names';
import { taskContext } from './task-context';
import { worktreeDir } from '../paths';
import type { SupervisorPorts } from './ports';

export const IN_FLIGHT = [
  'setting_up',
  'running',
  'waiting',
  'blocked',
  'delivering',
  'queued',
] as const;

const headlessPid = (
  events: readonly { event: FactoryEvent }[],
  attemptId: string,
): number | undefined => {
  for (const { event } of events) {
    if (event.type === 'agent_ready' && event.attemptId === attemptId) {
      const pid = Number(event.pane.slice(HEADLESS_PANE_PREFIX.length));
      return event.pane.startsWith(HEADLESS_PANE_PREFIX) && pid > 0
        ? pid
        : undefined;
    }
  }
  return undefined;
};

/**
 * Brings every unfinished task back to where its log says it is, once, at
 * startup. Live panes are re-adopted; dead ones are recorded as crashed.
 */
export const reconcile = async (ports: SupervisorPorts): Promise<void> => {
  const tasks = ports.store.tasks({ status: [...IN_FLIGHT] });
  for (const task of tasks) {
    await reconcileTask(ports, task.id);
  }
};

export const reconcileTask = async (
  ports: SupervisorPorts,
  taskId: string,
): Promise<void> => {
  const { task, workflow } = taskContext(ports, taskId);
  const events = ports.store.events(taskId);
  const state = reduce(workflow, events);

  // Setup started but never finished: drop the half-made worktree; the engine runs setup again.
  const setupStarted = events.some(
    (stored) => stored.event.type === 'setup_started',
  );
  const setupFinished = events.some(
    (stored) => stored.event.type === 'setup_finished',
  );
  if (setupStarted && !setupFinished) {
    await ports.git.removeWorktree(worktreeDir(ports.root, task.id));
    return;
  }

  const current = state.current;
  if (
    current !== undefined &&
    (current.status === 'starting' || current.status === 'running')
  ) {
    const step = workflow.steps.find(
      (candidate) => candidate.id === current.stepId,
    );
    if (step?.type === 'agent' && workflow.agents[step.agent]?.headless) {
      // The supervisor that held the process is gone, so nobody records its end.
      // Stop it so it cannot write while the retry runs, then fail the attempt.
      const pid = headlessPid(events, current.attemptId);
      if (pid !== undefined) ports.process.kill(pid);
      ports.store.append(task.id, {
        type: 'attempt_failed',
        attemptId: current.attemptId,
        reason: 'crashed',
        detail:
          'the headless run was not finished when the supervisor restarted',
      });
    } else if (step?.type === 'agent') {
      const alive = await ports.herdr.exists(
        agentName(task.id, step.id, current.n),
      );
      if (!alive) {
        ports.store.append(task.id, {
          type: 'attempt_failed',
          attemptId: current.attemptId,
          reason: 'crashed',
          detail: 'the agent pane was gone when the supervisor restarted',
        });
      }
    } else {
      ports.store.append(task.id, {
        type: 'attempt_failed',
        attemptId: current.attemptId,
        reason: 'crashed',
        detail: 'the gate was interrupted; the engine runs it again',
      });
    }
  }

  // A live operator whose pane vanished while the supervisor was down is a crashed attempt.
  const operator = state.operator;
  if (
    operator !== undefined &&
    (operator.status === 'starting' || operator.status === 'running')
  ) {
    const alive = await ports.herdr.exists(
      agentName(task.id, operator.stepId, operator.n),
    );
    if (!alive) {
      ports.store.append(task.id, {
        type: 'attempt_failed',
        attemptId: operator.attemptId,
        reason: 'crashed',
        detail: 'the operator pane was gone when the supervisor restarted',
      });
    }
  }

  // Delivery started but never recorded an outcome: the engine runs deliver
  // again. Delivery is idempotent, so the existing PR is reused, not duplicated.
};
