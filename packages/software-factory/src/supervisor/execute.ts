import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ArtifactRef,
  AgentStep,
  Role,
  Step,
  Workflow,
} from '../definitions/types';
import type { SupervisorAction } from '../engine/actions';
import { resolveAttemptContext, type AttemptContext } from '../engine/context';
import type { FactoryEvent } from '../engine/events';
import { nextAction } from '../engine/next-action';
import type { TaskState } from '../engine/state';
import { guideKind, renderCliCommands } from '../cli/guide';
import { evidenceDir as evidenceDirFor, worktreeDir } from '../paths';
import { buildPrompt } from '../prompts/build-prompt';
import { renderTemplate } from '../prompts/render';
import type { TaskRow } from '../ports/store.port';
import type { SupervisorPorts, VerificationItem } from './ports';
import { agentName, snapshotRefFor, tabLabel } from './names';
import {
  commandResultText,
  commandStartText,
  consoleLine,
} from './console-lines';
import { runGate } from './gate';
import { publishBlockedWork } from './blocked-work';
import { HEADLESS_PANE_PREFIX, launchHeadless } from './headless';
import { launchAgent } from './launch';
import { notifyQuietly } from './notify';
import { plainPaint, type Paint } from '../paint';
import { watchAttempt } from './observe';
import { startOperator } from './operator';
import { errorText, reduceNow, taskContext, todoBodyOf } from './task-context';

/** Appends one event to the task's log. */
const record = (
  ports: SupervisorPorts,
  taskId: string,
  event: FactoryEvent,
): void => {
  ports.store.append(taskId, event);
};

/** Performs one action: intent event first, port calls, then the outcome event. */
export const execute = async (
  ports: SupervisorPorts,
  taskId: string,
  action: SupervisorAction,
  log: (line: string) => void = () => undefined,
  paint: Paint = plainPaint,
): Promise<void> => {
  const { task, workflow } = taskContext(ports, taskId);
  switch (action.type) {
    case 'idle':
      return;
    case 'setup':
      return setup(ports, task, workflow);
    case 'start_attempt':
      return startAttempt(ports, task, workflow, action, log, paint);
    case 'start_operator':
      return startOperator(ports, task, workflow, action);
    case 'deliver_prompt':
      return deliverPrompt(ports, task, workflow, action);
    case 'watch':
      return watchAttempt(
        ports,
        taskId,
        workflow,
        action.attemptId,
        log,
        paint,
      );
    case 'deliver':
      return deliver(ports, task, workflow, action.to);
    case 'block': {
      record(ports, taskId, {
        type: 'blocked',
        reason: action.reason,
        detail: action.detail,
      });
      // While the operator may still triage the incident, the work is not yet final.
      const after = nextAction(workflow, reduceNow(ports, workflow, taskId));
      if (after.type === 'start_operator') return;
      return publishBlockedWork(ports, task, action.reason, action.detail);
    }
  }
};

/** Types a pending answer or nudge into the agent's pane. A failed delivery is retried next tick. */
const deliverPrompt = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
  action: Extract<SupervisorAction, { type: 'deliver_prompt' }>,
): Promise<void> => {
  const state = reduceNow(ports, workflow, task.id);
  const target = [...state.attempts, state.operator].find(
    (attempt) => attempt?.attemptId === action.attemptId,
  );
  if (target === undefined) return;
  const name = agentName(task.id, target.stepId, target.n);
  const text =
    action.kind === 'answer'
      ? renderTemplate(templateBody(ports, 'answer'), {
          question: action.question ?? '',
          answer: action.text,
        })
      : action.text;
  if (action.kind === 'keys') {
    // Keys answer a menu the agent is showing; a failed press is retried next tick.
    try {
      await ports.herdr.sendKeys(name, action.keys ?? []);
    } catch {
      return;
    }
    record(ports, task.id, {
      type: 'prompt_delivered',
      attemptId: action.attemptId,
      kind: 'keys',
    });
    return;
  }
  let sent: 'accepted' | 'blocked';
  try {
    sent = await ports.herdr.prompt(name, text);
  } catch {
    return;
  }
  if (sent === 'blocked') {
    record(ports, task.id, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: `agent ${name} blocked on a prompt`,
    });
    return;
  }
  record(ports, task.id, {
    type: 'prompt_delivered',
    attemptId: action.attemptId,
    kind: action.kind,
  });
};

const templateBody = (ports: SupervisorPorts, id: string): string => {
  const template = ports.definitions.templates.get(id);
  if (template === undefined) throw new Error(`template "${id}" is not loaded`);
  return template.body;
};

const setup = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
): Promise<void> => {
  const worktree = worktreeDir(ports.root, task.id);
  const logDir = join(ports.root, '.evidences', task.id);
  mkdirSync(logDir, { recursive: true });
  record(ports, task.id, { type: 'setup_started' });

  // Sync runs in the repo root before any worktree exists: a failure leaves none behind.
  const { sync } = workflow;
  if (sync !== undefined) {
    for (const [index, command] of sync.exec.entries()) {
      const syncLog = join(logDir, `sync-${index}.log`);
      const result = await ports.system.run({
        command,
        cwd: ports.root,
        timeoutMs: sync.timeoutMs,
        logPath: syncLog,
      });
      if (result.timedOut || result.exitCode !== 0) {
        record(ports, task.id, {
          type: 'setup_finished',
          ok: false,
          log: syncLog,
        });
        return;
      }
    }
  }

  try {
    await ports.git.createWorktree({
      path: worktree,
      branch: task.branch,
      base: ports.baseRef,
    });
  } catch (error) {
    const log = join(logDir, 'setup-worktree.log');
    writeFileSync(log, errorText(error));
    record(ports, task.id, { type: 'setup_finished', ok: false, log });
    return;
  }

  let log = '';
  for (const [index, command] of workflow.setup.exec.entries()) {
    log = join(logDir, `setup-${index}.log`);
    const result = await ports.system.run({
      command,
      cwd: worktree,
      timeoutMs: workflow.setup.timeoutMs,
      logPath: log,
    });
    if (result.timedOut || result.exitCode !== 0) {
      record(ports, task.id, { type: 'setup_finished', ok: false, log });
      return;
    }
  }
  record(ports, task.id, { type: 'setup_finished', ok: true, log });
};

const startAttempt = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
  action: Extract<SupervisorAction, { type: 'start_attempt' }>,
  log: (line: string) => void,
  paint: Paint,
): Promise<void> => {
  const step = workflow.steps.find(
    (candidate) => candidate.id === action.stepId,
  );
  if (step === undefined) {
    throw new Error(
      `step "${action.stepId}" is not in workflow "${workflow.name}"`,
    );
  }
  const attemptId = randomUUID();
  const dir = evidenceDirFor(ports.root, task.id, attemptId);
  const worktree = worktreeDir(ports.root, task.id);
  const snapshotRef = snapshotRefFor(task.id, step.id, attemptId);
  const artifacts = artifactPaths(ports, step, workflow, dir);
  mkdirSync(dir, { recursive: true });

  // Intent first: the attempt exists in the log before any port call.
  record(ports, task.id, {
    type: 'attempt_started',
    attemptId,
    stepId: step.id,
    n: action.n,
    snapshotRef,
    artifacts,
    ...(action.restartOf === undefined ? {} : { restartOf: action.restartOf }),
    ...(action.feedbackFrom === undefined
      ? {}
      : { feedbackFrom: action.feedbackFrom }),
  });

  try {
    if (action.restoreSnapshot !== undefined) {
      await ports.git.restore({ worktree, ref: action.restoreSnapshot });
    }
    await ports.git.snapshot({ worktree, ref: snapshotRef });
  } catch (error) {
    record(ports, task.id, {
      type: 'attempt_failed',
      attemptId,
      reason: 'start_failed',
      detail: errorText(error),
    });
    return;
  }

  if (step.type === 'commands') {
    const gate = await runGate(ports.system, {
      exec: step.exec,
      timeoutMs: step.timeoutMs,
      cwd: worktree,
      evidenceDir: dir,
      onCommand: (progress) => {
        const { command, index, total, result } = progress;
        log(
          consoleLine(
            workflow.name,
            result === undefined
              ? commandStartText(step.id, command, index, total, paint)
              : commandResultText(
                  step.id,
                  command,
                  index,
                  total,
                  result,
                  paint,
                ),
          ),
        );
      },
    });
    record(ports, task.id, {
      type: 'gate_finished',
      attemptId,
      passed: gate.passed,
      failures: gate.failures,
    });
    return;
  }

  await startAgent(
    ports,
    task,
    workflow,
    step,
    attemptId,
    action.n,
    dir,
    worktree,
  );
};

/** The attempt's declared artifacts, as absolute paths in its evidence directory. */
const artifactPaths = (
  ports: SupervisorPorts,
  step: Step,
  workflow: Workflow,
  dir: string,
): Record<string, string> => {
  if (step.type !== 'agent') return {};
  const role = roleFor(ports, workflow, step);
  return Object.fromEntries(
    Object.entries(role.artifacts).map(([key, file]) => [key, join(dir, file)]),
  );
};

const roleFor = (
  ports: SupervisorPorts,
  workflow: Workflow,
  step: AgentStep,
): Role => {
  const agent = workflow.agents[step.agent];
  const role =
    agent === undefined ? undefined : ports.definitions.roles.get(agent.role);
  if (agent === undefined || role === undefined) {
    throw new Error(`step "${step.id}" has no agent role`);
  }
  return role;
};

const startAgent = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
  step: AgentStep,
  attemptId: string,
  n: number,
  dir: string,
  worktree: string,
): Promise<void> => {
  const agent = workflow.agents[step.agent];
  const role = roleFor(ports, workflow, step);
  if (agent === undefined) throw new Error(`unknown agent "${step.agent}"`);

  try {
    // The reduced state includes the new attempt, so its feedback is resolved too.
    const state = reduceNow(ports, workflow, task.id);
    const context = resolveAttemptContext(workflow, state, step.id);
    const promptPath = join(dir, 'prompt.md');
    const prompt = buildPrompt({
      role,
      templates: ports.definitions.templates,
      taskId: task.id,
      attemptId,
      todoBody: todoBodyOf(ports, task),
      context,
      artifacts: artifactPaths(ports, step, workflow, dir),
      evidenceDir: dir,
      budget: budgetFor(workflow, state, context),
      cliCommands: renderCliCommands(guideKind(role)),
    });
    writeFileSync(promptPath, prompt);

    if (agent.headless) {
      const { pid } = launchHeadless(ports, {
        taskId: task.id,
        attemptId,
        agent,
        worktree,
        promptPath,
        evidenceDir: dir,
      });
      record(ports, task.id, {
        type: 'agent_ready',
        attemptId,
        pane: `${HEADLESS_PANE_PREFIX}${pid}`,
        tab: '',
      });
      return;
    }

    const { tabId, paneId } = await launchAgent(ports, {
      taskId: task.id,
      attemptId,
      agent,
      name: agentName(task.id, step.id, n),
      tab: tabLabel(step.id, n),
      worktree,
      promptPath,
      evidenceDir: dir,
    });
    record(ports, task.id, {
      type: 'agent_ready',
      attemptId,
      pane: paneId,
      tab: tabId,
    });
  } catch (error) {
    record(ports, task.id, {
      type: 'attempt_failed',
      attemptId,
      reason: 'start_failed',
      detail: errorText(error),
    });
  }
};

/** The feedback retry counter shown to the worker: the retry about to run, out of its budget. */
const budgetFor = (
  workflow: Workflow,
  state: TaskState,
  context: AttemptContext,
): { retry: number; max: number } | undefined => {
  if (context.feedback === undefined) return undefined;
  const failed = state.attempts.find(
    (attempt) => attempt.attemptId === context.feedback?.fromAttempt,
  );
  const failedStep = workflow.steps.find((step) => step.id === failed?.stepId);
  if (failed === undefined || failedStep?.onFail === undefined)
    return undefined;
  const used = state.retriesUsed[failed.stepId] ?? 0;
  const isRetry = state.current?.restartOf === undefined;
  return { retry: used + (isRetry ? 1 : 0), max: failedStep.onFail.max };
};

const deliver = async (
  ports: SupervisorPorts,
  task: TaskRow,
  workflow: Workflow,
  to: 'new-pr',
): Promise<void> => {
  record(ports, task.id, { type: 'delivery_started', to });
  const worktree = worktreeDir(ports.root, task.id);
  let prUrlDelivered = '';
  try {
    const state = reduceNow(ports, workflow, task.id);
    const { prUrl } = await ports.deliverer.deliver({
      taskId: task.id,
      to,
      worktree,
      branch: task.branch,
      commitFile: artifactOf(state, workflow.deliver.commit),
      reportFile: artifactOf(state, workflow.deliver.report),
      todoPath: existsSync(join(ports.root, task.todoPath))
        ? join(ports.root, task.todoPath)
        : join(worktree, task.todoPath),
      todoRelPath: task.todoPath,
      verification: verificationFor(workflow, state),
    });
    record(ports, task.id, { type: 'delivered', prUrl });
    prUrlDelivered = prUrl;
  } catch (error) {
    record(ports, task.id, {
      type: 'delivery_failed',
      detail: errorText(error),
    });
    return;
  }
  await notifyQuietly(ports, task.id, `Task Delivered: ${task.id}`, {
    body: prUrlDelivered,
    sound: 'done',
  });
  await cleanupAfterDelivery(ports, task.id, worktree);
};

/**
 * The PR checklist: one line per gate command and per agent step, checked only
 * when that step's latest result passed. Nothing is checked by default.
 */
export const verificationFor = (
  workflow: Workflow,
  state: TaskState,
): VerificationItem[] => {
  return workflow.steps.flatMap((step): VerificationItem[] => {
    const passed = state.lastPassed[step.id] !== undefined;
    if (step.type === 'commands') {
      return step.exec.map((command) => ({
        label: `\`${command}\``,
        passed,
      }));
    }
    const agent = workflow.agents[step.agent];
    const role = agent === undefined ? step.agent : agent.role;
    return [{ label: `Agent step \`${step.id}\` (${role})`, passed }];
  });
};

/** The file of an artifact the latest passed attempt of its step wrote. */
const artifactOf = (state: TaskState, ref: ArtifactRef): string => {
  const attemptId = state.lastPassed[ref.stepId];
  const attempt = state.attempts.find(
    (candidate) => candidate.attemptId === attemptId,
  );
  const path = attempt?.artifacts[ref.artifactKey];
  if (path === undefined) {
    throw new Error(
      `artifact ${ref.stepId}.${ref.artifactKey} was not produced`,
    );
  }
  return path;
};

/**
 * Removes the worktree, the task's snapshot refs and its Herdr workspace once the
 * PR exists. Failures are written to the task's evidence, never raised: the
 * delivery already happened.
 */
const cleanupAfterDelivery = async (
  ports: SupervisorPorts,
  taskId: string,
  worktree: string,
): Promise<void> => {
  try {
    await ports.git.removeWorktree(worktree);
    await ports.git.deleteSnapshotRefs(taskId);
    const workspaceId = ports.workspaces.get(taskId);
    if (workspaceId !== undefined) {
      await ports.herdr.closeWorkspace(workspaceId);
      ports.workspaces.delete(taskId);
    }
  } catch (error) {
    const log = join(ports.root, '.evidences', taskId, 'cleanup.log');
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, errorText(error));
  }
};
