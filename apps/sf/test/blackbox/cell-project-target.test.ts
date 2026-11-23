import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';
import { freePort, runFactoryCommand } from '../support/factory-cli';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;
const TOKEN = 'sf_operator_stub';
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
let registered: RegisteredProject[] = [];
let env: Record<string, string>;
let home: string;

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const replyJson = (
  status: number,
  body: unknown,
  response: ServerResponse,
): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const repoWithConfig = (root: string, project: string): string => {
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(repo, '.factory', 'config.json'),
    JSON.stringify({ project }),
  );
  writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  return repo;
};

const runSf = (args: readonly string[]): Promise<CliResult> =>
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

const listen = (server: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('stub did not bind'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

beforeAll(async () => {
  registered = [
    {
      projectId: PROJECT_ID,
      repoUrl: 'https://example.test/software-factory.git',
      defaultBaseBranch: 'main',
    },
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
    if (
      request.method === 'POST' &&
      request.url === '/api/v1/factories/heartbeat'
    ) {
      replyJson(200, { code: 200, factoryId: 'factory-stub' }, response);
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v1/tokens') {
      replyJson(
        201,
        {
          code: 201,
          tokenId: 'tok-1',
          kind: 'factory_join',
          token: 'sf_join_stub',
          scopes: [],
          expiresAt: null,
        },
        response,
      );
      return;
    }
    replyJson(404, { code: 404, message: 'not stubbed' }, response);
  });
  factoryUrl = await listen(factory);

  home = mkdtempSync(join(tmpdir(), 'sf-project-target-'));
  dirs.push(home);
  mkdirSync(join(home, 'config', 'sf'), { recursive: true });
  writeFileSync(
    join(home, 'config', 'sf', 'factory.json'),
    JSON.stringify({
      url: factoryUrl,
      factoryId: 'factory-stub',
      sessionToken: 'sf_factory_session_stub',
    }),
    { mode: 0o600 },
  );
  env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    SF_FACTORY_PORT: String(await freePort()),
    FACTORY_URL: factoryUrl,
    FACTORY_TOKEN: TOKEN,
  };
  expect(await runFactoryCommand(env, 'start')).toBe(EXIT.ok);
});

afterAll(async () => {
  await runFactoryCommand(env, 'stop');
  await new Promise<void>((resolve) => factory.close(() => resolve()));
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cell project target', () => {
  it(
    'takes the project of the repo config without asking',
    async () => {
      // Arrange
      const repo = repoWithConfig(home, PROJECT_ID);

      // Act
      const result = await runSf([
        'cell',
        'scale',
        '1',
        '--repo',
        repo,
        '--json',
      ]);
      await runSf(['cell', 'scale', '0', '--repo', repo]);

      // Assert
      expect(result.status).toBe(EXIT.ok);
      expect(JSON.parse(result.stdout)).toEqual({ projectId: PROJECT_ID });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses to scale a cell outside a project repo',
    async () => {
      // Arrange
      const outside = mkdtempSync(join(tmpdir(), 'sf-no-repo-'));
      dirs.push(outside);

      // Act
      const result = await runSf(['cell', 'scale', '1', '--repo', outside]);

      // Assert
      expect(result.status).toBe(EXIT.refused);
      expect(result.stderr).toContain(
        'a Cell starts only inside a project repo',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it('refuses cell start run by hand, outside the Factory daemon', async () => {
    // Arrange
    const outside = mkdtempSync(join(tmpdir(), 'sf-no-repo-'));
    dirs.push(outside);
    const outsideEnv = { ...env, HOME: outside };

    // Act
    const result = await new Promise<CliResult>((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, 'cell', 'start'], {
        cwd: outside,
        env: outsideEnv,
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('close', (code) =>
        resolve({ status: code ?? -1, stdout: '', stderr }),
      );
    });

    // Assert
    expect(result.status).toBe(EXIT.refused);
    expect(result.stderr).toContain('sf cell scale N');
  });
});
