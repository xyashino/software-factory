import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';
import { PROJECTS_REPLY, PROJECTS_ROUTE } from '../support/fake-ports';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TOKEN = 'sf_supervisor_stub';
const FEATURE_LINE = 'name: feature\nstations: []\n';

const dirs: string[] = [];
let factory: Server;
let factoryUrl: string;

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

const sandbox = async (): Promise<{
  env: Record<string, string>;
  repo: string;
}> => {
  const home = mkdtempSync(join(tmpdir(), 'sf-local-single-'));
  dirs.push(home);
  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(repo, '.factory', 'config.json'),
    JSON.stringify({ project: 'software-factory' }),
  );
  writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  return {
    repo,
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

beforeAll(async () => {
  factory = createServer((request, response) => {
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
    if (request.method === 'GET' && request.url === PROJECTS_ROUTE) {
      replyJson(200, PROJECTS_REPLY, response);
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

describe('single factory server cell lifecycle', () => {
  it('creates, lists, stops and removes a local cell without a cell server', async () => {
    // Arrange
    const { env, repo } = await sandbox();

    // Act
    const created = await runSf(env, [
      'cell',
      'create',
      '--repo',
      repo,
      '--json',
    ]);
    const [slot] = JSON.parse(created.stdout) as {
      slotId: string;
      name: string;
    }[];
    const listed = await runSf(env, ['cell', 'list', '--here', '--json']);
    const stopped = await runSf(env, ['cell', 'stop', slot?.slotId ?? '']);
    const afterStop = await runSf(env, ['cell', 'list', '--here', '--json']);
    const removed = await runSf(env, ['cell', 'rm', slot?.slotId ?? '']);
    const afterRemove = await runSf(env, ['cell', 'list', '--here', '--json']);

    // Assert
    expect(created.status).toBe(EXIT.ok);
    expect(slot?.name).toMatch(/^[a-z0-9-]+$/);
    expect(JSON.parse(listed.stdout)).toEqual([
      expect.objectContaining({ slotId: slot?.slotId, state: 'running' }),
    ]);
    expect(stopped.stdout.trim()).toBe(`cell ${slot?.slotId} stopped`);
    expect(JSON.parse(afterStop.stdout)).toEqual([
      expect.objectContaining({
        slotId: slot?.slotId,
        state: 'stopped',
        pid: null,
      }),
    ]);
    expect(removed.stdout.trim()).toBe(`removed ${slot?.slotId}`);
    expect(JSON.parse(afterRemove.stdout)).toEqual([]);
  });

  it('refuses a fixed name for more than one cell', async () => {
    // Arrange
    const { env, repo } = await sandbox();

    // Act
    const result = await runSf(env, [
      'cell',
      'create',
      '--repo',
      repo,
      '--count',
      '2',
      '--name',
      'shared',
    ]);

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain('name is only allowed with count 1');
  });
});
