import { z } from 'zod';
import type { Access } from '../../../domain/access';
import { parentPath, joinPath } from '../../../domain/common/path';
import { recoveryCommandOf } from '../../../domain/connection/connection-config';
import { parseLine, type LineSnapshot } from '../../../domain/line/parse-line';
import { parseRepoConfig } from '../../../domain/repo-config/parse-repo-config';
import { define, type Ports } from '../../core/procedure';
import { listProjects } from '../projects/list-projects.procedure';

// Spawn failure reported by the process adapter: the binary is not on PATH.
const BINARY_NOT_FOUND = 127;
const LINE_FILE = /\.ya?ml$/;
const SUPERVISOR: Access = { kind: 'supervisor' };

const DoctorSchema = z
  .object({
    repoRoot: z.string().min(1),
    repoConfigPath: z.string().min(1),
    linesDir: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
  })
  .strict();

export type CheckStatus = 'ok' | 'warn' | 'missing';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

interface LoadedLine {
  file: string;
  snapshot: LineSnapshot;
}

const check = (
  name: string,
  status: CheckStatus,
  detail: string,
  fix?: string,
): DoctorCheck =>
  fix === undefined ? { name, status, detail } : { name, status, detail, fix };

const binaryPresent = async (
  ctx: Ports,
  binary: string,
  cwd: string,
): Promise<boolean> =>
  (await ctx.process.run(binary, ['--version'], cwd)).exitCode !==
  BINARY_NOT_FOUND;

const writable = async (
  ctx: Ports,
  path: string,
  cwd: string,
): Promise<boolean> => {
  let target = path;
  while (!(await ctx.fs.exists(target))) {
    const parent = parentPath(target);
    if (parent === target) return false;
    target = parent;
  }
  return (await ctx.process.run('test', ['-w', target], cwd)).exitCode === 0;
};

const loadLines = async (
  ctx: Ports,
  linesDir: string,
): Promise<{ lines: LoadedLine[]; invalid: string[] }> => {
  const files = (await ctx.fs.list(linesDir))
    .filter((file) => LINE_FILE.test(file))
    .sort();
  const lines: LoadedLine[] = [];
  const invalid: string[] = [];
  for (const file of files) {
    try {
      const snapshot = parseLine(
        await ctx.fs.readText(joinPath(linesDir, file)),
      );
      lines.push({ file, snapshot });
    } catch {
      invalid.push(file);
    }
  }
  return { lines, invalid };
};

const runnersOf = (line: LineSnapshot): string[] => {
  const stationRunners = line.stations.flatMap((station) =>
    station.runner === null ? [] : [station.runner],
  );
  return line.mechanic === null
    ? stationRunners
    : [...stationRunners, line.mechanic.runner];
};

const needsHerdr = (line: LineSnapshot): boolean =>
  line.stations.some((station) => !station.headless) ||
  (line.mechanic !== null && !line.mechanic.headless);

const runnerChecks = async (
  ctx: Ports,
  lines: LoadedLine[],
): Promise<DoctorCheck[]> => {
  const neededBy = new Map<string, Set<string>>();
  for (const { snapshot } of lines) {
    for (const runner of runnersOf(snapshot)) {
      neededBy.set(
        runner,
        (neededBy.get(runner) ?? new Set<string>()).add(snapshot.name),
      );
    }
  }
  return Promise.all(
    [...neededBy].map(async ([runner, names]) => {
      const name = `runner:${runner}`;
      if (await ctx.runners.isInstalled(runner)) {
        return check(name, 'ok', `runner ${runner} installed`);
      }
      return check(
        name,
        'missing',
        `runner ${runner} not installed, needed by line ${[...names].join(', ')}`,
        `install the ${runner} CLI and put it on PATH`,
      );
    }),
  );
};

const herdrCheck = async (
  ctx: Ports,
  cwd: string,
  lines: LoadedLine[],
): Promise<DoctorCheck[]> => {
  const headless = lines
    .filter(({ snapshot }) => needsHerdr(snapshot))
    .map(({ snapshot }) => snapshot.name);
  if (headless.length === 0) return [];
  if (await binaryPresent(ctx, 'herdr', cwd)) {
    return [check('herdr', 'ok', 'herdr installed')];
  }
  return [
    check(
      'herdr',
      'missing',
      `herdr not installed, needed by line ${headless.join(', ')} (headless: false)`,
      'install herdr and put it on PATH',
    ),
  ];
};

const repoProjectOf = async (
  ctx: Ports,
  repoConfigPath: string,
): Promise<string | null> => {
  if (!(await ctx.fs.exists(repoConfigPath))) return null;
  try {
    return parseRepoConfig(await ctx.fs.readText(repoConfigPath)).project;
  } catch {
    return null;
  }
};

const accessChecks = async (
  ctx: Ports,
  projectId: string | null,
): Promise<DoctorCheck[]> => {
  const url = ctx.connection.url;
  if (!(await ctx.hq.probe())) {
    return [
      check(
        'server',
        'missing',
        `no factory server answers at ${url}`,
        'start it with sf hq start',
      ),
      check('token', 'warn', 'token not checked, server unreachable'),
      check('project', 'warn', 'project not checked, server unreachable'),
    ];
  }
  const server = check('server', 'ok', `server answers at ${url}`);
  if ((await ctx.tokens.secret()) === null) {
    return [
      server,
      check('token', 'missing', 'no token stored', recoveryCommandOf(url)),
      check('project', 'warn', 'project not checked, no token'),
    ];
  }
  let projectIds: string[];
  try {
    const reply = await listProjects.execute(
      {},
      { ...ctx, token: SUPERVISOR, principal: SUPERVISOR },
    );
    projectIds = reply.projects.map((project) => project.projectId);
  } catch {
    return [
      server,
      check(
        'token',
        'missing',
        `token rejected by ${url}`,
        recoveryCommandOf(url),
      ),
      check('project', 'warn', 'project not checked, token rejected'),
    ];
  }
  const token = check('token', 'ok', `token accepted by ${url}`);
  if (projectId === null) {
    return [
      server,
      token,
      check('project', 'warn', 'project not checked, repo config missing'),
    ];
  }
  const project = projectIds.includes(projectId)
    ? check('project', 'ok', `project ${projectId} registered`)
    : check(
        'project',
        'missing',
        `project ${projectId} not registered on ${url}`,
        `sf project add ${projectId} --repo <repo url>`,
      );
  return [server, token, project];
};

const storageChecks = async (
  ctx: Ports,
  input: z.infer<typeof DoctorSchema>,
): Promise<DoctorCheck[]> => {
  const dataDirOk = await writable(ctx, input.dataDir, input.repoRoot);
  const dbOk = await writable(ctx, input.dbPath, input.repoRoot);
  return [
    dataDirOk
      ? check('data-dir', 'ok', `data dir ${input.dataDir} writable`)
      : check(
          'data-dir',
          'missing',
          `data dir ${input.dataDir} not writable`,
          'fix its owner or permissions, or set HQ_DATA_DIR',
        ),
    dbOk
      ? check('db-path', 'ok', `db path ${input.dbPath} writable`)
      : check(
          'db-path',
          'missing',
          `db path ${input.dbPath} not writable`,
          'fix its owner or permissions, or set HQ_DB_PATH',
        ),
  ];
};

export const runDoctor = define({ kind: 'supervisor' })(
  DoctorSchema,
)<DoctorResult>(async (input, ctx) => {
  const { lines, invalid } = await loadLines(ctx, input.linesDir);
  const projectId = await repoProjectOf(ctx, input.repoConfigPath);
  const gitOk = await binaryPresent(ctx, 'git', input.repoRoot);
  const gh = await ctx.process.run('gh', ['auth', 'status'], input.repoRoot);
  const checks: DoctorCheck[] = [
    gitOk
      ? check('git', 'ok', 'git installed')
      : check(
          'git',
          'missing',
          'git not installed',
          'install git and put it on PATH',
        ),
    gh.exitCode === 0
      ? check('gh', 'ok', 'gh authenticated')
      : check(
          'gh',
          'warn',
          gh.exitCode === BINARY_NOT_FOUND
            ? 'gh not installed, PR delivery needs it'
            : 'gh not authenticated, PR delivery needs it',
          gh.exitCode === BINARY_NOT_FOUND
            ? 'install the GitHub CLI and put it on PATH'
            : 'run gh auth login',
        ),
    ...(await runnerChecks(ctx, lines)),
    ...(await herdrCheck(ctx, input.repoRoot, lines)),
    projectId === null
      ? check(
          'repo-config',
          'missing',
          `repo config missing or invalid at ${input.repoConfigPath}`,
          'run sf init in the repo',
        )
      : check('repo-config', 'ok', `repo config names project ${projectId}`),
    ...(await accessChecks(ctx, projectId)),
    ...(await storageChecks(ctx, input)),
    ...invalid.map((file) =>
      check(
        `line:${file}`,
        'missing',
        `line ${file} is not a valid line file`,
        `fix the YAML in ${file}`,
      ),
    ),
  ];
  if (lines.length === 0 && invalid.length === 0) {
    checks.push(
      check(
        'lines',
        'warn',
        `no line files in ${input.linesDir}`,
        'add a line file, then rerun sf doctor',
      ),
    );
  }
  return {
    ok: checks.every((item) => item.status !== 'missing'),
    checks,
  };
});
