import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCliCommands } from '../cli/guide';
import type { Workflow } from '../definitions/types';
import type { SupervisorAction } from '../engine/actions';
import {
  OPERATOR_STEP,
  type AttemptState,
  type TaskState,
} from '../engine/state';
import { evidenceDir as evidenceDirFor, worktreeDir } from '../paths';
import type { TaskRow } from '../ports/store.port';
import { buildPrompt } from '../prompts/build-prompt';
import { renderTemplate } from '../prompts/render';
import { publishBlockedWork } from './blocked-work';
import { launchAgent } from './launch';
import { agentName, snapshotRefFor, tabLabel } from './names';
import type { SupervisorPorts } from './ports';
import { errorText, reduceNow, taskContext, todoBodyOf } from './task-context';

/** Lines of the blocked pane the operator reads. */
export const PANE_LINES = 50;

/**
 * Starts the on-call operator in its own Herdr tab. The attempt is recorded
 * first (intent before act); a failed start is an attempt failure, and the task
 * then waits for a human, since the operator already ran for this incident.
 */
export const startOperator = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
  action: Extract<SupervisorAction, { type: 'start_operator' }>,
): Promise<void> => {
  const agent = workflow.operator;
  const role =
    agent === undefined ? undefined : ports.definitions.roles.get(agent.role);
  if (agent === undefined || role === undefined) {
    throw new Error(`workflow "${workflow.name}" has no operator role`);
  }
  const before = reduceNow(ports, workflow, task.id);
  const n = operatorAttempts(ports, task.id) + 1;
  const attemptId = randomUUID();
  const dir = evidenceDirFor(ports.root, task.id, attemptId);
  const worktree = worktreeDir(ports.root, task.id);
  const artifacts = Object.fromEntries(
    Object.entries(role.artifacts).map(([key, file]) => [key, join(dir, file)]),
  );
  const snapshotRef = snapshotRefFor(task.id, OPERATOR_STEP, attemptId);
  mkdirSync(dir, { recursive: true });

  ports.store.append(task.id, {
    type: 'attempt_started',
    attemptId,
    stepId: OPERATOR_STEP,
    n,
    snapshotRef,
    artifacts,
  });

  try {
    await ports.git.snapshot({ worktree, ref: snapshotRef });
    const pane = await readBlockedPane(ports, task.id, before, action);
    const incident = renderTemplate(templateBody(ports, 'incident'), {
      reason: action.reason,
      detail: action.detail,
      pane,
      feedback: feedbackText(before),
    });
    const promptPath = join(dir, 'prompt.md');
    writeFileSync(
      promptPath,
      buildPrompt({
        role,
        templates: ports.definitions.templates,
        taskId: task.id,
        attemptId,
        todoBody: todoBodyOf(ports, task),
        context: { inputs: [], notes: [], feedback: undefined },
        artifacts,
        evidenceDir: dir,
        budget: undefined,
        cliCommands: renderCliCommands('operator'),
        extraContext: [incident],
      }),
    );
    await closePreviousOperatorTabs(ports, task.id);
    const { tabId, paneId } = await launchAgent(ports, {
      taskId: task.id,
      attemptId,
      agent,
      name: agentName(task.id, OPERATOR_STEP, n),
      tab: tabLabel(OPERATOR_STEP, n),
      worktree,
      promptPath,
      evidenceDir: dir,
    });
    ports.store.append(task.id, {
      type: 'agent_ready',
      attemptId,
      pane: paneId,
      tab: tabId,
    });
  } catch (error) {
    ports.store.append(task.id, {
      type: 'attempt_failed',
      attemptId,
      reason: 'start_failed',
      detail: errorText(error),
    });
  }
};

/**
 * At most one operator pane per task: the operator runs one incident at a time, so
 * every earlier operator tab is finished. Its report stays in the evidence folder.
 */
export const closePreviousOperatorTabs = async (
  ports: SupervisorPorts,
  taskId: string,
): Promise<void> => {
  const events = ports.store.events(taskId);
  const operatorAttempts = new Set(
    events
      .filter(
        (stored) =>
          stored.event.type === 'attempt_started' &&
          stored.event.stepId === OPERATOR_STEP,
      )
      .map((stored) =>
        stored.event.type === 'attempt_started' ? stored.event.attemptId : '',
      ),
  );
  const tabs = new Set(
    events
      .filter(
        (stored) =>
          stored.event.type === 'agent_ready' &&
          operatorAttempts.has(stored.event.attemptId) &&
          stored.event.tab !== '',
      )
      .map((stored) =>
        stored.event.type === 'agent_ready' ? stored.event.tab : '',
      ),
  );
  for (const tab of tabs) {
    try {
      await ports.herdr.closeTab(tab);
    } catch {
      // A tab that cannot be closed stays open; it does not stop the operator.
    }
  }
};

const operatorAttempts = (ports: SupervisorPorts, taskId: string): number => {
  return ports.store
    .events(taskId)
    .filter(
      (stored) =>
        stored.event.type === 'attempt_started' &&
        stored.event.stepId === OPERATOR_STEP,
    ).length;
};

const templateBody = (ports: SupervisorPorts, id: string): string => {
  const template = ports.definitions.templates.get(id);
  if (template === undefined) throw new Error(`template "${id}" is not loaded`);
  return template.body;
};

/** The last lines of the pane a runner prompt blocked; empty for every other incident. */
const readBlockedPane = async (
  ports: SupervisorPorts,
  taskId: string,
  state: TaskState,
  action: Extract<SupervisorAction, { type: 'start_operator' }>,
): Promise<string> => {
  const blocked = state.current;
  if (action.reason !== 'runner_prompt' || blocked === undefined) {
    return '(not a runner prompt)';
  }
  try {
    const text = await ports.herdr.read(
      agentName(taskId, blocked.stepId, blocked.n),
      PANE_LINES,
    );
    return text.trim().length === 0 ? '(the pane is empty)' : text;
  } catch {
    return '(the pane could not be read)';
  }
};

/** What the latest failing judge or gate said, for the incident prompt. */
const feedbackText = (state: TaskState): string => {
  const failed = state.current;
  if (failed === undefined) return '(none)';
  if (failed.outcome === 'verdict_fail') {
    if (failed.feedbackPath === undefined)
      return '(the judge wrote no feedback)';
    return readOr(failed.feedbackPath, '(the feedback file is unreadable)');
  }
  if (failed.outcome === 'gate_fail') {
    return failed.failures
      .map(
        (failure) =>
          `${failure.command} (exit ${failure.exitCode ?? 'timed out'}), log ${failure.logPath}\n${failure.tail}`,
      )
      .join('\n\n');
  }
  return '(none)';
};

const readOr = (path: string, fallback: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
};

/**
 * True when another agent attempt was live, or reported anything, since the
 * operator started. Such an agent may have written to the worktree meanwhile.
 */
const otherAgentWorked = (
  ports: SupervisorPorts,
  taskId: string,
  workflow: Workflow,
  operator: AttemptState,
): boolean => {
  const state = reduceNow(ports, workflow, taskId);
  const others = new Set(
    state.attempts
      .filter(
        (attempt) =>
          attempt.attemptId !== operator.attemptId &&
          attempt.stepId !== OPERATOR_STEP,
      )
      .map((attempt) => attempt.attemptId),
  );
  if (
    state.attempts.some(
      (attempt) =>
        others.has(attempt.attemptId) &&
        (attempt.status === 'starting' || attempt.status === 'running'),
    )
  ) {
    return true;
  }
  // Order by sequence number, not time: several events can share a millisecond.
  const stored = ports.store.events(taskId);
  const start = stored.find(
    (item) =>
      item.event.type === 'attempt_started' &&
      item.event.attemptId === operator.attemptId,
  );
  if (start === undefined) return false;
  return stored.some(
    (item) =>
      item.seq > start.seq &&
      'attemptId' in item.event &&
      typeof item.event.attemptId === 'string' &&
      others.has(item.event.attemptId),
  );
};

/**
 * Closes out an operator attempt that ended: the worktree must be untouched
 * (the operator never edits it) and the incident must be resolved. Anything
 * else goes to a human. Runs once per operator attempt.
 */
export const settleOperator = async (
  ports: SupervisorPorts,
  taskId: string,
  workflow: Workflow,
  operator: AttemptState,
): Promise<void> => {
  const { task } = taskContext(ports, taskId);
  const worktree = worktreeDir(ports.root, taskId);
  let changed = false;
  if (existsSync(worktree)) {
    try {
      changed = await ports.git.differsFromSnapshot({
        worktree,
        ref: operator.snapshotRef,
      });
    } catch (error) {
      ports.store.append(taskId, {
        type: 'operator_checked',
        attemptId: operator.attemptId,
        changed: false,
      });
      ports.store.append(taskId, {
        type: 'blocked',
        reason: 'infra',
        detail: `could not check the worktree after the operator: ${errorText(error)}`,
      });
      return;
    }
  }
  // A worker that was live during the operator's turn writes to the same
  // worktree; its edits cannot be told apart from the operator's, so the check
  // says nothing about the operator and must not block the task.
  const inconclusive =
    changed && otherAgentWorked(ports, taskId, workflow, operator);
  ports.store.append(taskId, {
    type: 'operator_checked',
    attemptId: operator.attemptId,
    changed: changed && !inconclusive,
  });

  if (changed && !inconclusive) {
    const detail = 'operator changed worktree';
    ports.store.append(taskId, { type: 'blocked', reason: 'infra', detail });
    await publishBlockedWork(ports, task, 'infra', detail);
    return;
  }
  const state = reduceNow(ports, workflow, taskId);
  const unresolved =
    state.block !== undefined || state.openQuestion !== undefined;
  if (unresolved && state.escalation === undefined) {
    ports.store.append(taskId, {
      type: 'escalated',
      text: `the operator ${operator.outcome ?? 'finished'} without resolving the incident`,
    });
  }
};
