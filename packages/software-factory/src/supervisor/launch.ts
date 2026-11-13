import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentDef } from '../definitions/types';
import { getRunner } from '../adapters/runners/registry';
import { PACKAGE_BIN_DIR, supervisorLogPath } from '../paths';
import type { SupervisorPorts } from './ports';
import { confirmTrustPrompt } from './trust-prompt';

/** The one line an agent is given: where its prompt file is. Pane and headless runs share it. */
export const kickoffText = (promptPath: string): string => {
  return `Read ${promptPath} and follow it exactly. Finish with the sf command it names.`;
};

/**
 * One Herdr workspace per task, created on the first agent and reused after restarts.
 * Checked before every attempt. Only a `not found` answer replaces the workspace;
 * any other Herdr error propagates and fails the start as before.
 */
export const ensureWorkspace = async (
  ports: SupervisorPorts,
  taskId: string,
  worktree: string,
  evidenceDir: string,
): Promise<string> => {
  const existing = ports.workspaces.get(taskId);
  if (existing !== undefined && (await ports.herdr.workspaceExists(existing))) {
    return existing;
  }
  const { workspaceId, tabId, paneId } = await ports.herdr.createWorkspace(
    taskId,
    worktree,
  );
  ports.workspaces.set(taskId, workspaceId);
  if (existing !== undefined) {
    appendFileSync(
      join(evidenceDir, 'workspace.log'),
      `workspace ${existing} missing in Herdr; replaced by ${workspaceId}\n`,
    );
  }
  if (tabId !== undefined) {
    try {
      await ports.herdr.renameTab(tabId, 'logs');
    } catch {
      // renaming the initial tab is cosmetic
    }
  }
  if (paneId !== undefined) {
    const logPath = supervisorLogPath(ports.root, taskId);
    mkdirSync(dirname(logPath), { recursive: true });
    if (!existsSync(logPath)) {
      writeFileSync(logPath, '');
    }
    try {
      await ports.herdr.runPane(
        paneId,
        `printf '\\033[2J\\033[3J\\033[H' && exec tail -n +1 -f "${logPath}"`,
      );
    } catch {
      // streaming logs into the initial pane is cosmetic
    }
  }
  try {
    await ports.herdr.createTab({
      workspaceId,
      label: 'cli',
      cwd: worktree,
      env: {
        FACTORY_ROOT: ports.root,
        FACTORY_TASK: taskId,
        PATH: `${PACKAGE_BIN_DIR}:${ports.pathEnv}`,
      },
    });
  } catch {
    // the interactive shell tab is a convenience; the task runs without it
  }
  return workspaceId;
};

/** Herdr's answer when an agent is still on a startup screen and cannot take a start. */
const NOT_READY = 'agent_not_ready';
const STARTUP_WAIT_MS = 30_000;

/**
 * Herdr refused the start because the agent sits on the folder-trust screen. The
 * worktree is the factory's own, and the trust option is the highlighted default,
 * so the supervisor confirms it and lets the start go on. Any other screen keeps
 * the original error: it is not this known case.
 */
const acceptStartupTrust = async (
  ports: SupervisorPorts,
  name: string,
  error: unknown,
): Promise<boolean> => {
  if (!(error instanceof Error) || !error.message.includes(NOT_READY)) {
    return false;
  }
  if (!(await confirmTrustPrompt(ports.herdr, name))) return false;
  await ports.herdr.wait(name, STARTUP_WAIT_MS);
  return true;
};

/**
 * Opens a tab, starts the agent in it and hands it its prompt file. Herdr is the
 * only way an agent starts. Throws when any of these steps fails.
 */
export const launchAgent = async (
  ports: SupervisorPorts,
  input: {
    taskId: string;
    attemptId: string;
    agent: AgentDef;
    name: string;
    tab: string;
    worktree: string;
    promptPath: string;
    evidenceDir: string;
  },
): Promise<{ tabId: string; paneId: string }> => {
  const runner = getRunner(input.agent.runner);
  if (runner === undefined) {
    throw new Error(`no adapter for runner "${input.agent.runner}"`);
  }
  const workspaceId = await ensureWorkspace(
    ports,
    input.taskId,
    input.worktree,
    input.evidenceDir,
  );
  const { tabId, paneId } = await ports.herdr.createTab({
    workspaceId,
    label: input.tab,
    cwd: input.worktree,
    env: {
      FACTORY_ROOT: ports.root,
      FACTORY_TASK: input.taskId,
      FACTORY_ATTEMPT: input.attemptId,
      PATH: `${PACKAGE_BIN_DIR}:${ports.pathEnv}`,
    },
  });
  const startInput = {
    name: input.name,
    kind: runner.kind,
    paneId,
    args: runner.startArgs({
      model: input.agent.model,
      addDirs: [join(ports.root, '.evidences')],
      permission: input.agent.permission,
    }),
    timeoutMs: 60_000,
  };
  try {
    await ports.herdr.startAgent(startInput);
  } catch (error) {
    if (!(await acceptStartupTrust(ports, input.name, error))) throw error;
  }
  const kickoff = kickoffText(input.promptPath);
  let submitted = await ports.herdr.prompt(input.name, kickoff);
  // A trust screen can appear after the start: confirm it once, then send the kickoff again.
  if (submitted === 'blocked') {
    if (await confirmTrustPrompt(ports.herdr, input.name).catch(() => false)) {
      await ports.herdr.wait(input.name, STARTUP_WAIT_MS);
      submitted = await ports.herdr.prompt(input.name, kickoff);
    }
  }
  if (submitted === 'blocked') {
    const screen = await ports.herdr.readScreen(input.name).catch(() => '');
    throw new Error(
      `the agent refused the prompt: blocked; screen: ${screen.trim().slice(0, 600)}`,
    );
  }
  return { tabId, paneId };
};
