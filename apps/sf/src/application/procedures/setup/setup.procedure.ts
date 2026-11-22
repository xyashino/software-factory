import { z } from 'zod';
import type { Access } from '../../../domain/access';
import { cellNameOf } from '../../../domain/cell/cell-name';
import { LOCAL_TARGET } from '../../../domain/connection/connection-config';
import { ArgumentError, Refused, Unreachable } from '../../core/errors';
import { type Context, define } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { livePidOf } from '../cell/local-pid';
import { createLocalCells } from '../cell/local-create.procedure';
import { type DoctorCheck, doctor } from '../doctor/doctor.procedure';
import { initProject } from '../init/init.procedure';
import { addProject } from '../projects/add-project.procedure';
import { listProjects } from '../projects/list-projects.procedure';
import { startServer } from '../server/start.procedure';

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_MAX_RUNNING = 5;
const LINES_CHECK = 'lines';
const CHECKS_FIXED_BY_SETUP = new Set(['server', 'token', 'project']);

const SetupSchema = z
  .object({
    cwd: z.string().min(1),
    dirName: z.string(),
    configPath: z.string().min(1),
    linesDir: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
    bin: z.string().min(1),
    serverArgs: z.array(z.string().min(1)).min(1),
    port: z.number().int().positive(),
    host: z.string().min(1).optional(),
    launcher: z.array(z.string()),
    cell: z.string().min(1).optional(),
  })
  .strict();

type SetupInput = z.infer<typeof SetupSchema>;

export type SetupStepName = 'doctor' | 'init' | 'server' | 'project' | 'cell';

export interface SetupStep {
  step: SetupStepName;
  status: 'ran' | 'skipped' | 'failed';
  detail: string;
}

export interface SetupResult {
  ok: boolean;
  steps: SetupStep[];
}

type StepOutcome = Omit<SetupStep, 'step'>;

const fixedBySetup = (check: DoctorCheck, configExists: boolean): boolean =>
  CHECKS_FIXED_BY_SETUP.has(check.name) ||
  // init writes the starter lines, so doctor cannot judge them before init
  (!configExists && check.name === LINES_CHECK);

const settled = async (
  attempt: () => Promise<StepOutcome>,
): Promise<StepOutcome> => {
  try {
    return await attempt();
  } catch (error) {
    if (
      error instanceof Refused ||
      error instanceof Unreachable ||
      error instanceof ArgumentError
    ) {
      return { status: 'failed', detail: error.message };
    }
    throw error;
  }
};

const doctorOutcome = async (
  ctx: Context<Access>,
  input: SetupInput,
  configExists: boolean,
): Promise<StepOutcome> => {
  const report = await doctor.execute(
    {
      cwd: input.cwd,
      linesDir: input.linesDir,
      configPath: input.configPath,
      dataDir: input.dataDir,
      dbPath: input.dbPath,
    },
    ctx,
  );
  const blocking = report.checks.filter(
    (check) => check.status === 'missing' && !fixedBySetup(check, configExists),
  );
  if (blocking.length === 0) {
    return { status: 'skipped', detail: 'checks pass' };
  }
  return {
    status: 'failed',
    detail: blocking
      .map(
        (check) =>
          `${check.name}: ${check.detail ?? ''}; fix: ${check.fix ?? ''}`,
      )
      .join(' | '),
  };
};

const initOutcome = async (
  ctx: Context<Access>,
  input: SetupInput,
): Promise<StepOutcome> => {
  if (await ctx.fs.exists(input.configPath)) {
    return { status: 'skipped', detail: 'repo config exists' };
  }
  const result = await initProject.execute(
    {
      root: input.cwd,
      dirName: input.dirName,
      projectId: null,
      force: false,
    },
    ctx,
  );
  return {
    status: 'ran',
    detail: `project ${result.projectId}, wrote ${result.written.length} file(s)`,
  };
};

const serverOutcome = async (
  ctx: Context<Access>,
  input: SetupInput,
): Promise<StepOutcome> => {
  if (await ctx.server.probe()) {
    return { status: 'skipped', detail: 'already answering' };
  }
  const result = await startServer.execute(
    {
      bin: input.bin,
      serverArgs: input.serverArgs,
      cwd: input.cwd,
      dataDir: input.dataDir,
      dbPath: input.dbPath,
      port: input.port,
      host: input.host,
    },
    ctx,
  );
  return { status: 'ran', detail: `pid ${result.pid}` };
};

// The supervisor token is only known after server start, and the ports
// snapshot the token at build time, so read the one startServer saved.
const withSavedToken = (ctx: Context<Access>): Context<Access> => {
  const saved = ctx.connections.read().targets[LOCAL_TARGET]?.token;
  if (saved === undefined || ctx.connection.token !== null) {
    return ctx;
  }
  return { ...ctx, tokens: { ...ctx.tokens, secret: async () => saved } };
};

const projectOutcome = async (
  ctx: Context<Access>,
  input: SetupInput,
): Promise<StepOutcome> => {
  const projectId = await readProjectId(ctx, input.configPath);
  const { projects } = await listProjects.execute({}, ctx);
  if (projects.some((project) => project.projectId === projectId)) {
    return { status: 'skipped', detail: `${projectId} registered` };
  }
  const repoUrl = await ctx.git.originUrl(input.cwd);
  if (repoUrl === null) {
    return {
      status: 'failed',
      detail: `no git origin remote; fix: sf project add ${projectId} --repo <repo-url>`,
    };
  }
  await addProject.execute(
    {
      projectId,
      repoUrl,
      defaultBaseBranch: DEFAULT_BASE_BRANCH,
      maxRunning: DEFAULT_MAX_RUNNING,
    },
    ctx,
  );
  return { status: 'ran', detail: `${projectId} registered from origin` };
};

const cellOutcome = async (
  ctx: Context<Access>,
  input: SetupInput,
): Promise<StepOutcome> => {
  if (input.cell === undefined) {
    return { status: 'skipped', detail: 'no --cell' };
  }
  const name = cellNameOf(input.cell);
  const running = (await ctx.localSlots.read()).some(
    (slot) => slot.name === name && livePidOf(ctx, slot) !== null,
  );
  if (running) {
    return { status: 'skipped', detail: `cell ${name} running` };
  }
  await createLocalCells.execute(
    {
      repoRoot: input.cwd,
      count: 1,
      name,
      baseName: name,
      launcher: input.launcher,
    },
    ctx,
  );
  return { status: 'ran', detail: `cell ${name} started` };
};

export const setup = define({ kind: 'supervisor' })(SetupSchema)<SetupResult>(
  async (input, ctx) => {
    const configExists = await ctx.fs.exists(input.configPath);
    const plan: [SetupStepName, () => Promise<StepOutcome>][] = [
      ['doctor', () => doctorOutcome(ctx, input, configExists)],
      ['init', () => initOutcome(ctx, input)],
      ['server', () => serverOutcome(ctx, input)],
      ['project', () => projectOutcome(withSavedToken(ctx), input)],
      ['cell', () => cellOutcome(withSavedToken(ctx), input)],
    ];
    const steps: SetupStep[] = [];
    for (const [step, attempt] of plan) {
      const outcome = await settled(attempt);
      steps.push({ step, ...outcome });
      if (outcome.status === 'failed') {
        break;
      }
    }
    return { ok: steps.every((step) => step.status !== 'failed'), steps };
  },
);
