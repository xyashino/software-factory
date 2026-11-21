import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TOKEN = 'sf_supervisor_stub';
const FEATURE_LINE = 'name: feature\nstations: []\n';
const PROJECT_ID = 'software-factory';
const PROJECTS_ROUTE = '/api/v1/projects';

interface RegisteredProject {
  projectId: string;
  repoUrl: string;
  defaultBaseBranch: string;
}

const dirs: string[] = [];
let factory: Server;
let factoryUrl: string;
let remoteUrl: string;
let registered: RegisteredProject[] = [];

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'sf-test',
  GIT_AUTHOR_EMAIL: 'sf-test@example.test',
  GIT_COMMITTER_NAME: 'sf-test',
  GIT_COMMITTER_EMAIL: 'sf-test@example.test',
};

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
};

const closedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('no free port'));
          return;
        }
        resolve(address.port);
      });
    });
  });

const replyJson = (
  status: number,
  body: unknown,
  response: ServerResponse,
): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const seedRemote = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-project-remote-'));
  dirs.push(root);
  const remote = join(root, `${PROJECT_ID}.git`);
  const seed = join(root, 'seed');
  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  mkdirSync(join(seed, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(seed, '.factory', 'config.json'),
    JSON.stringify({ project: PROJECT_ID }),
  );
  writeFileSync(join(seed, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  git(seed, ['init', '--initial-branch=main']);
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'seed']);
  git(seed, ['push', remote, 'main']);
  return remote;
};

const sandbox = async (): Promise<{
  env: Record<string, string>;
  home: string;
}> => {
  const home = mkdtempSync(join(tmpdir(), 'sf-project-target-'));
  dirs.push(home);
  return {
    home,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_DATA_HOME: join(home, 'data'),
      FACTORY_URL: factoryUrl,
      FACTORY_TOKEN: TOKEN,
      CELL_SERVER_URL: `http://127.0.0.1:${await closedPort()}`,
    },
  };
};

const repoWithConfig = (home: string): string => {
  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(repo, '.factory', 'config.json'),
    JSON.stringify({ project: PROJECT_ID }),
  );
  writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  return repo;
};

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const runSf = (
  env: Record<string, string>,
  args: readonly string[],
): Promise<CliResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: env.HOME,
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? -1, stdout, stderr });
    });
  });

const createdSlot = async (
  env: Record<string, string>,
  args: readonly string[],
): Promise<{ result: CliResult; slotId: string; repoRoot: string }> => {
  const result = await runSf(env, ['cell', 'create', ...args, '--json']);
  const [slot] = JSON.parse(result.stdout || '[]') as {
    slotId: string;
    repoRoot: string;
  }[];
  return { result, slotId: slot?.slotId ?? '', repoRoot: slot?.repoRoot ?? '' };
};

const removeSlot = async (
  env: Record<string, string>,
  slotId: string,
): Promise<void> => {
  await runSf(env, ['cell', 'stop', slotId]);
  await runSf(env, ['cell', 'rm', slotId]);
};

beforeAll(async () => {
  remoteUrl = seedRemote();
  registered = [
    { projectId: PROJECT_ID, repoUrl: remoteUrl, defaultBaseBranch: 'main' },
  ];
  factory = createServer((request, response) => {
    if (request.method === 'GET' && request.url === PROJECTS_ROUTE) {
      replyJson(
        200,
        {
          code: 200,
          projects: registered.map((project) => ({
            ...project,
            maxRunning: 5,
            createdAt: 1,
            updatedAt: 1,
          })),
        },
        response,
      );
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v1/tokens') {
      replyJson(
        201,
        {
          code: 201,
          tokenId: 'tok-1',
          kind: 'cell_join',
          token: 'sf_cell_join_stub',
          scopes: [],
          expiresAt: null,
        },
        response,
      );
      return;
    }
    if (request.method === 'GET' && request.url === '/api/v1/cells') {
      replyJson(200, { code: 200, cells: [] }, response);
      return;
    }
    replyJson(404, { code: 404, message: 'not stubbed' }, response);
  });
  await new Promise<void>((resolve) => {
    factory.listen(0, '127.0.0.1', () => resolve());
  });
  const address = factory.address();
  if (address === null || typeof address === 'string') {
    throw new Error('factory stub did not bind');
  }
  factoryUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => factory.close(() => resolve()));
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cell project target', () => {
  it('auto-assigns the project of a repo config without asking', async () => {
    // Arrange
    const { env, home } = await sandbox();
    const repo = repoWithConfig(home);

    // Act
    const { result, slotId, repoRoot } = await createdSlot(env, [
      '--repo',
      repo,
    ]);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    expect(repoRoot).toBe(repo);
    await removeSlot(env, slotId);
  });

  it('asks for --project outside a repo without a terminal and lists the ids', async () => {
    // Arrange
    const { env, home } = await sandbox();

    // Act
    const { result } = await createdSlot(env, ['--repo', home]);

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain(PROJECT_ID);
  });

  it('refuses an unregistered --project and hints at sf project add', async () => {
    // Arrange
    const { env, home } = await sandbox();

    // Act
    const { result } = await createdSlot(env, [
      '--repo',
      home,
      '--project',
      'ghost',
    ]);

    // Assert
    expect(result.status).toBe(EXIT.refused);
    expect(result.stderr).toContain('sf project add ghost');
  });

  it('clones a registered --project into the workspace outside a repo', async () => {
    // Arrange
    const { env, home } = await sandbox();
    const workspace = join(home, 'data', 'sf', 'workspaces', PROJECT_ID);

    // Act
    const { result, slotId, repoRoot } = await createdSlot(env, [
      '--repo',
      home,
      '--project',
      PROJECT_ID,
    ]);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    expect(repoRoot).toBe(workspace);
    expect(
      existsSync(join(workspace, '.factory', 'lines', 'feature.yml')),
    ).toBe(true);
    await removeSlot(env, slotId);
  });

  it('refuses to create a cell when no project is registered', async () => {
    // Arrange
    const { env, home } = await sandbox();
    const before = registered;
    registered = [];

    try {
      // Act
      const { result } = await createdSlot(env, ['--repo', home]);

      // Assert
      expect(result.status).toBe(EXIT.refused);
      expect(result.stderr).toContain('sf project add');
    } finally {
      registered = before;
    }
  });

  it('exits 2 when cell start runs outside a repo without --project', async () => {
    // Arrange
    const { env } = await sandbox();

    // Act
    const result = await runSf(env, ['cell', 'start']);

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain(PROJECT_ID);
  });
});
