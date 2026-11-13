import type { Definitions, Role, Workflow } from '../definitions/types';
import { reduce } from '../engine/reduce';
import { OPERATOR_STEP, type AttemptState } from '../engine/state';
import type { StorePort } from '../ports/store.port';
import { evidenceDir } from '../paths';

/** The in-pane CLI was called from outside an active attempt, or the attempt is not usable. */
export class CallerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallerError';
  }
}

/** Everything an in-pane command needs to know about the attempt that calls it. */
export interface Caller {
  root: string;
  taskId: string;
  attemptId: string;
  workflow: Workflow;
  /** the role of this attempt: its agent step's, or the workflow's operator */
  role: Role;
  /** the attempt is the on-call operator, not a step of the assembly line */
  isOperator: boolean;
  attempt: AttemptState;
  evidenceDir: string;
  store: StorePort;
}

/**
 * Identifies the caller only by FACTORY_ROOT, FACTORY_TASK and FACTORY_ATTEMPT,
 * then checks in the store that the attempt is still running.
 */
export const resolveCaller = (
  env: Readonly<Record<string, string | undefined>>,
  store: StorePort,
  definitions: Definitions,
): Caller => {
  const root = env.FACTORY_ROOT;
  const taskId = env.FACTORY_TASK;
  const attemptId = env.FACTORY_ATTEMPT;
  if (!root || !taskId || !attemptId) {
    throw new CallerError(
      'not inside an active software-factory agent pane: FACTORY_ROOT, FACTORY_TASK and FACTORY_ATTEMPT must all be set',
    );
  }

  const running = store.runningAttempt(taskId, attemptId);
  if (running === undefined) {
    throw new CallerError(
      `attempt ${attemptId} of task ${taskId} is not running; nothing to report`,
    );
  }

  const row = store.tasks().find((task) => task.id === taskId);
  if (row === undefined) {
    throw new CallerError(`task ${taskId} is not in the store`);
  }
  const workflow = definitions.workflows.get(row.workflow);
  if (workflow === undefined) {
    throw new CallerError(`workflow "${row.workflow}" is not defined`);
  }

  const state = reduce(workflow, store.events(taskId));
  const isOperator = state.operator?.attemptId === attemptId;
  const attempt = isOperator
    ? state.operator
    : state.attempts.find((item) => item.attemptId === attemptId);
  if (attempt === undefined) {
    throw new CallerError(`attempt ${attemptId} is missing from the event log`);
  }
  const roleId = roleIdOf(workflow, attempt, isOperator);
  const role = roleId === undefined ? undefined : definitions.roles.get(roleId);
  if (role === undefined) {
    throw new CallerError(`step "${attempt.stepId}" has no role definition`);
  }

  return {
    root,
    taskId,
    attemptId,
    workflow,
    role,
    isOperator,
    attempt,
    evidenceDir: evidenceDir(root, taskId, attemptId),
    store,
  };
};

const roleIdOf = (
  workflow: Workflow,
  attempt: AttemptState,
  isOperator: boolean,
): string | undefined => {
  if (isOperator) return workflow.operator?.role;
  if (attempt.stepId === OPERATOR_STEP) return undefined;
  const step = workflow.steps.find((item) => item.id === attempt.stepId);
  if (step?.type !== 'agent') {
    throw new CallerError(`step "${attempt.stepId}" is not an agent step`);
  }
  return workflow.agents[step.agent]?.role;
};
