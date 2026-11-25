import { z } from 'zod';
import type { Access } from '../../../domain/access';
import { SF_VERSION } from '../../../version';
import { ArgumentError, Refused } from '../../core/errors';
import { define, type Context, type Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { listFactoryProjects, scaleFactoryCells } from '../cell/factory-cells';
import { runDoctor, type DoctorCheck } from '../doctor/doctor.procedure';
import { initProject } from '../init/init.procedure';
import { addProject } from '../projects/add-project.procedure';
import { listProjects } from '../projects/list-projects.procedure';
import { startHq } from '../hq/start.procedure';

const SUPERVISOR: Access = { kind: 'supervisor' };
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_MAX_RUNNING = 5;
// Checks that setup itself repairs, so they must not block the run.
const SETUP_FIXES = ['server', 'token', 'project', 'repo-config'];

const SetupSchema = z
  .object({
    repoRoot: z.string().min(1),
    dirName: z.string(),
    repoConfigPath: z.string().min(1),
    linesDir: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
    port: z.number().int().positive(),
    host: z.string().min(1).optional(),
    bin: z.string().min(1),
    serverArgs: z.array(z.string().min(1)).min(1),
    project: z.string().min(1).optional(),
    cell: z.boolean().optional(),
    reconnect: z.custom<() => Ports>((value) => typeof value === 'function'),
  })
  .strict();

export type SetupStepName = 'doctor' | 'init' | 'server' | 'project' | 'cell';

export interface SetupStep {
  step: SetupStepName;
  outcome: 'done' | 'skipped';
}

export interface SetupResult {
  steps: SetupStep[];
}

const asSupervisor = (ports: Ports): Context<Access> => ({
  ...ports,
  token: SUPERVISOR,
  principal: SUPERVISOR,
});

const formatCheck = (item: DoctorCheck): string =>
  item.fix === undefined
    ? `${item.status}: ${item.detail}`
    : `${item.status}: ${item.detail}; fix: ${item.fix}`;

const blockingLines = (checks: DoctorCheck[]): string[] =>
  checks
    .filter(
      (item) => item.status === 'missing' && !SETUP_FIXES.includes(item.name),
    )
    .map(formatCheck);

export const runSetup = define({ kind: 'supervisor' })(
  SetupSchema,
)<SetupResult>(async (input, ctx) => {
  const steps: SetupStep[] = [];

  const doctor = await runDoctor.execute(
    {
      repoRoot: input.repoRoot,
      repoConfigPath: input.repoConfigPath,
      linesDir: input.linesDir,
      dataDir: input.dataDir,
      dbPath: input.dbPath,
      cliVersion: SF_VERSION,
    },
    ctx,
  );
  const blocking = blockingLines(doctor.checks);
  if (blocking.length > 0) {
    throw new Refused(blocking.join('\n'));
  }
  steps.push({ step: 'doctor', outcome: 'done' });

  const configExists = await ctx.fs.exists(input.repoConfigPath);
  if (configExists) {
    const configured = await readProjectId(ctx, input.repoConfigPath);
    if (input.project !== undefined && input.project !== configured) {
      throw new ArgumentError(
        `repo config names project ${configured}, not --project ${input.project}`,
      );
    }
    steps.push({ step: 'init', outcome: 'skipped' });
  } else {
    await initProject.execute(
      {
        root: input.repoRoot,
        dirName: input.dirName,
        projectId: input.project ?? null,
        force: false,
      },
      ctx,
    );
    steps.push({ step: 'init', outcome: 'done' });
  }

  if (await ctx.hq.probe()) {
    steps.push({ step: 'server', outcome: 'skipped' });
  } else {
    await startHq.execute(
      {
        bin: input.bin,
        serverArgs: input.serverArgs,
        cwd: input.repoRoot,
        dataDir: input.dataDir,
        dbPath: input.dbPath,
        port: input.port,
        host: input.host,
      },
      ctx,
    );
    steps.push({ step: 'server', outcome: 'done' });
  }

  // Server start saves the supervisor token, which the ports built before it do not see.
  const fresh = asSupervisor(input.reconnect());

  const projectId = await readProjectId(ctx, input.repoConfigPath);
  const registered = (await listProjects.execute({}, fresh)).projects.some(
    (project) => project.projectId === projectId,
  );
  if (registered) {
    steps.push({ step: 'project', outcome: 'skipped' });
  } else {
    const repoUrl = await ctx.git.originUrl(input.repoRoot);
    if (repoUrl === null) {
      throw new ArgumentError(
        'no git origin remote, add one with git remote add origin <url>',
      );
    }
    await addProject.execute(
      {
        projectId,
        repoUrl,
        defaultBaseBranch: DEFAULT_BASE_BRANCH,
        maxRunning: DEFAULT_MAX_RUNNING,
      },
      fresh,
    );
    steps.push({ step: 'project', outcome: 'done' });
  }

  if (input.cell) {
    const live = (await listFactoryProjects.execute({}, fresh)).some(
      (project) => project.repoRoot === input.repoRoot && project.running > 0,
    );
    if (live) {
      steps.push({ step: 'cell', outcome: 'skipped' });
    } else {
      await scaleFactoryCells.execute(
        { repoRoot: input.repoRoot, count: 1 },
        fresh,
      );
      steps.push({ step: 'cell', outcome: 'done' });
    }
  }

  return { steps };
});
