import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef } from '../definitions/types';
import { getRunner } from '../adapters/runners/registry';
import { PACKAGE_BIN_DIR } from '../paths';
import type { SupervisorPorts } from './ports';
import { kickoffText } from './launch';

export const STDOUT_LOG = 'headless-stdout.log';
export const STDERR_LOG = 'headless-stderr.log';

/** The pane id a headless attempt records in `agent_ready`: there is no pane, only a pid. */
export const HEADLESS_PANE_PREFIX = 'headless:';

const readOrEmpty = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/**
 * After the process ends: usage is parsed from stdout, never the verdict. An
 * attempt still running at that point never reported `done` or `verdict`, so it
 * failed: `timed_out` when the supervisor's timeout killed it, else `crashed`.
 */
const settle = async (
  ports: SupervisorPorts,
  input: {
    taskId: string;
    attemptId: string;
    agent: AgentDef;
    evidenceDir: string;
  },
  exit: Promise<{ exitCode: number | null; timedOut: boolean }>,
): Promise<void> => {
  const result = await exit;
  const runner = getRunner(input.agent.runner);
  const usage = runner?.parseUsage?.(
    readOrEmpty(join(input.evidenceDir, STDOUT_LOG)),
  );
  if (usage !== undefined) {
    ports.store.append(input.taskId, {
      type: 'usage_recorded',
      attemptId: input.attemptId,
      model: input.agent.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    });
  }
  if (ports.store.runningAttempt(input.taskId, input.attemptId) === undefined) {
    return;
  }
  ports.store.append(input.taskId, {
    type: 'attempt_failed',
    attemptId: input.attemptId,
    reason: result.timedOut ? 'timed_out' : 'crashed',
    detail: result.timedOut
      ? `headless run exceeded its ${input.agent.timeoutMs}ms timeout`
      : `headless run exited with code ${result.exitCode} without done or verdict`,
  });
};

/**
 * Starts the agent's runner in print mode in the task worktree and returns at
 * once. Completion is handled in the background; the attempt itself finishes
 * through `software-factory done` / `verdict`, like a pane agent. Throws when the
 * runner has no print mode.
 */
export const launchHeadless = (
  ports: SupervisorPorts,
  input: {
    taskId: string;
    attemptId: string;
    agent: AgentDef;
    worktree: string;
    promptPath: string;
    evidenceDir: string;
  },
): { pid: number } => {
  const runner = getRunner(input.agent.runner);
  if (runner?.binary === undefined || runner.headlessArgs === undefined) {
    throw new Error(`runner "${input.agent.runner}" has no headless mode`);
  }
  const argv = runner.headlessArgs({
    model: input.agent.model,
    permission: input.agent.permission,
    prompt: kickoffText(input.promptPath),
    addDirs: [join(ports.root, '.evidences')],
  });
  const child = ports.process.spawn({
    command: [runner.binary, ...argv],
    cwd: input.worktree,
    env: {
      FACTORY_ROOT: ports.root,
      FACTORY_TASK: input.taskId,
      FACTORY_ATTEMPT: input.attemptId,
      PATH: `${PACKAGE_BIN_DIR}:${ports.pathEnv}`,
    },
    timeoutMs: input.agent.timeoutMs,
    stdoutPath: join(input.evidenceDir, STDOUT_LOG),
    stderrPath: join(input.evidenceDir, STDERR_LOG),
  });
  // Not awaited: the tick must not block on a long run. The store may already be
  // closed when a run outlives the supervisor; reconcile fails such an attempt.
  void settle(ports, input, child.exit).catch(() => undefined);
  return { pid: child.pid };
};
