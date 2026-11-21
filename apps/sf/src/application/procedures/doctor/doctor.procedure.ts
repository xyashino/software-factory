import { z } from 'zod';
import type { Access } from '../../../domain/access';
import { recoveryCommandOf } from '../../../domain/connection/connection-config';
import { parseLine, type LineSnapshot } from '../../../domain/line/parse-line';
import { Unauthorized, Unreachable } from '../../core/errors';
import { define, type Context, type Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { listProjects } from '../projects/list-projects.procedure';

const GIT = 'git';
const GH = 'gh';
const HERDR = 'herdr';
const SPAWN_FAILED_EXIT = 127;
const SERVER_START_FIX = 'sf server start';

const DoctorSchema = z
  .object({
    cwd: z.string().min(1),
    linesDir: z.string().min(1),
    configPath: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
  })
  .strict();

export type CheckStatus = 'ok' | 'warn' | 'missing';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

type LineLoad =
  | { kind: 'line'; snapshot: LineSnapshot }
  | { kind: 'broken'; check: DoctorCheck };

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');

const okCheck = (name: string, detail?: string): DoctorCheck => ({
  name,
  status: 'ok',
  detail,
});

const missingCheck = (
  name: string,
  detail: string,
  fix: string,
): DoctorCheck => ({
  name,
  status: 'missing',
  detail,
  fix,
});

const warnCheck = (name: string, detail: string): DoctorCheck => ({
  name,
  status: 'warn',
  detail,
});

const runnersOf = (line: LineSnapshot): string[] => [
  ...line.stations.flatMap((station) =>
    station.runner === null ? [] : [station.runner],
  ),
  ...(line.mechanic === null ? [] : [line.mechanic.runner]),
];

const needsHerdr = (line: LineSnapshot): boolean =>
  line.stations.some((station) => !station.headless) ||
  line.mechanic?.headless === false;

const isInstalled = async (
  ctx: Ports,
  command: string,
  cwd: string,
): Promise<boolean> =>
  (await ctx.process.run(command, ['--version'], cwd)).exitCode !==
  SPAWN_FAILED_EXIT;

const loadLine = async (ctx: Ports, file: string): Promise<LineLoad> => {
  try {
    return { kind: 'line', snapshot: parseLine(await ctx.fs.readText(file)) };
  } catch (error) {
    return {
      kind: 'broken',
      check: missingCheck(`line ${file}`, errorText(error), `fix ${file}`),
    };
  }
};

const toolChecks = async (ctx: Ports, cwd: string): Promise<DoctorCheck[]> => {
  const hasGit = await isInstalled(ctx, GIT, cwd);
  const hasGh = await isInstalled(ctx, GH, cwd);
  const checks = [
    hasGit
      ? okCheck('git')
      : missingCheck('git', 'not installed', 'install git and put it on PATH'),
    hasGh
      ? okCheck('gh')
      : missingCheck(
          'gh',
          'not installed',
          'install the GitHub CLI and put it on PATH',
        ),
  ];
  if (hasGh) {
    const auth = await ctx.process.run(GH, ['auth', 'status'], cwd);
    checks.push(
      auth.exitCode === 0
        ? okCheck('gh auth')
        : missingCheck('gh auth', 'not logged in', 'gh auth login'),
    );
  }
  return checks;
};

const lineChecks = async (
  ctx: Ports,
  linesDir: string,
): Promise<{ lines: LineSnapshot[]; checks: DoctorCheck[] }> => {
  const files = (await ctx.fs.list(linesDir)).filter((name) =>
    name.endsWith('.yml'),
  );
  if (files.length === 0) {
    return {
      lines: [],
      checks: [
        missingCheck(
          'lines',
          `no line files in ${linesDir}`,
          'add a line file under .factory/lines',
        ),
      ],
    };
  }
  const loads = await Promise.all(
    files.map((file) => loadLine(ctx, `${linesDir}/${file}`)),
  );
  return {
    lines: loads.flatMap((load) =>
      load.kind === 'line' ? [load.snapshot] : [],
    ),
    checks: loads.flatMap((load) =>
      load.kind === 'broken' ? [load.check] : [],
    ),
  };
};

const runnerChecks = async (
  ctx: Ports,
  lines: LineSnapshot[],
): Promise<DoctorCheck[]> => {
  const usedBy = new Map<string, Set<string>>();
  for (const line of lines) {
    for (const runner of runnersOf(line)) {
      usedBy.set(runner, (usedBy.get(runner) ?? new Set()).add(line.name));
    }
  }
  return Promise.all(
    [...usedBy].map(async ([runner, names]) =>
      (await ctx.runners.isInstalled(runner))
        ? okCheck(`runner ${runner}`)
        : missingCheck(
            `runner ${runner}`,
            `needed by line ${[...names].join(', ')}`,
            `install the ${runner} CLI and put it on PATH`,
          ),
    ),
  );
};

const pathCheck = async (
  ctx: Ports,
  name: string,
  path: string,
  fix: string,
): Promise<DoctorCheck> =>
  (await ctx.fs.writable(path))
    ? okCheck(name, path)
    : missingCheck(name, `${path} is not writable`, fix);

const serverDownChecks = (url: string): DoctorCheck[] => [
  missingCheck('server', `${url} does not answer`, SERVER_START_FIX),
  warnCheck('token', 'skipped, server not answering'),
  warnCheck('project', 'skipped, server not answering'),
];

const serverChecks = async (
  ctx: Context<Access>,
  configPath: string,
): Promise<DoctorCheck[]> => {
  const url = ctx.connection.url;
  if (!(await ctx.server.probe())) {
    return serverDownChecks(url);
  }
  const server = okCheck('server', url);
  if ((await ctx.tokens.secret()) === null) {
    return [
      server,
      missingCheck('token', 'no token stored', recoveryCommandOf(url)),
      warnCheck('project', 'skipped, no token'),
    ];
  }
  let projects: { projectId: string }[];
  try {
    projects = (await listProjects.execute({}, ctx)).projects;
  } catch (error) {
    if (error instanceof Unauthorized) {
      return [
        server,
        missingCheck('token', 'rejected by server', recoveryCommandOf(url)),
        warnCheck('project', 'skipped, token rejected'),
      ];
    }
    if (error instanceof Unreachable) {
      return serverDownChecks(url);
    }
    throw error;
  }
  return [
    server,
    okCheck('token'),
    await projectCheck(ctx, configPath, projects),
  ];
};

const projectCheck = async (
  ctx: Ports,
  configPath: string,
  projects: { projectId: string }[],
): Promise<DoctorCheck> => {
  let projectId: string;
  try {
    projectId = await readProjectId(ctx, configPath);
  } catch (error) {
    return missingCheck(
      'project',
      errorText(error),
      `set a "project" id in ${configPath}`,
    );
  }
  return projects.some((project) => project.projectId === projectId)
    ? okCheck('project', projectId)
    : missingCheck(
        'project',
        `${projectId} is not registered on the server`,
        `sf project add ${projectId} --repo <repo-url>`,
      );
};

export const doctor = define({ kind: 'supervisor' })(
  DoctorSchema,
)<DoctorResult>(async (input, ctx) => {
  const lines = await lineChecks(ctx, input.linesDir);
  const herdrLines = lines.lines.filter(needsHerdr).map((line) => line.name);
  const checks: DoctorCheck[] = [
    ...(await toolChecks(ctx, input.cwd)),
    ...lines.checks,
    ...(await runnerChecks(ctx, lines.lines)),
  ];
  if (herdrLines.length > 0) {
    checks.push(
      (await isInstalled(ctx, HERDR, input.cwd))
        ? okCheck('herdr')
        : missingCheck(
            'herdr',
            `needed by headless: false line ${herdrLines.join(', ')}`,
            'install herdr and put it on PATH',
          ),
    );
  }
  checks.push(
    await pathCheck(
      ctx,
      'data dir',
      input.dataDir,
      'make the data dir writable or set FACTORY_DATA_DIR',
    ),
    await pathCheck(
      ctx,
      'db path',
      input.dbPath,
      'make the db dir writable or set FACTORY_DB_PATH',
    ),
    ...(await serverChecks(ctx, input.configPath)),
  );
  return {
    ok: checks.every((check) => check.status !== 'missing'),
    checks,
  };
});
