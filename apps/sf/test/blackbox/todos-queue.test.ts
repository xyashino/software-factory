import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const EXIT_ARGUMENT = 2;

const READY_TODO = `---
status: todo
priority: high
line: feature
plan: web-demo
---
# cli-05: queue

Body.
`;

const NO_LINE_TODO = `---
status: todo
---
# cli-06: later

Body.
`;

const PLANS = {
  code: 200,
  items: [{ planId: 'plan-9', slug: 'web-demo' }],
};

const ORDERS = {
  code: 200,
  items: [
    {
      orderId: 'wo-1',
      state: 'queued',
      lineName: 'feature',
      priority: 'high',
      planId: 'plan-9',
      activeCellId: null,
    },
  ],
};

interface Fixture {
  cwd: string;
  env: Record<string, string>;
  hits: { count: number };
  server: Server;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const fixture: { current?: Fixture } = {};

const serveFake = (hits: { count: number }): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      hits.count += 1;
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/api/v1/order-plans')) {
        response.end(JSON.stringify(PLANS));
        return;
      }
      if (request.url?.startsWith('/api/v1/work-orders')) {
        response.end(JSON.stringify(ORDERS));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ code: 404, message: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const createFixture = async (): Promise<Fixture> => {
  const hits = { count: 0 };
  const server = await serveFake(hits);
  const port = (server.address() as AddressInfo).port;
  const cwd = mkdtempSync(join(tmpdir(), 'factory-todos-cli-'));
  mkdirSync(join(cwd, '.factory'));
  writeFileSync(
    join(cwd, '.factory', 'config.json'),
    JSON.stringify({ project: 'software-factory' }),
  );
  mkdirSync(join(cwd, 'todos'));
  writeFileSync(join(cwd, 'todos', 'cli-05.md'), READY_TODO);
  writeFileSync(join(cwd, 'todos', 'cli-06.md'), NO_LINE_TODO);
  return {
    cwd,
    hits,
    server,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: cwd,
      FACTORY_TOKEN: 'test-token',
      FACTORY_URL: `http://127.0.0.1:${port}`,
    },
  };
};

const runCli = (args: readonly string[]): Promise<CliResult> =>
  new Promise((resolve) => {
    const { cwd, env } = fixture.current as Fixture;
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd, env, timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });

beforeAll(async () => {
  fixture.current = await createFixture();
});

afterAll(() => {
  fixture.current?.server.close();
});

describe('order import and queue commands', () => {
  it('lists todos/ files on order import --dry-run when orders/ is absent', async () => {
    // Arrange
    const hitsBefore = fixture.current?.hits.count ?? 0;

    // Act
    const result = await runCli(['order', 'import', '--dry-run']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('dry run: would send 1 file(s)');
    expect(result.stdout).toContain('skip cli-06.md: no line');
    expect(fixture.current?.hits.count).toBe(hitsBefore);
  });

  it('counts paused work orders on order import --paused --dry-run and leaves files unchanged', async () => {
    // Arrange
    const cwd = fixture.current?.cwd ?? '';
    const hitsBefore = fixture.current?.hits.count ?? 0;

    // Act
    const result = await runCli(['order', 'import', '--paused', '--dry-run']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('paused 1');
    expect(fixture.current?.hits.count).toBe(hitsBefore);
    expect(readFileSync(join(cwd, 'todos', 'cli-05.md'), 'utf8')).toBe(
      READY_TODO,
    );
  });

  it('exits 2 and sends nothing for queue cancel without --yes', async () => {
    // Arrange
    const hitsBefore = fixture.current?.hits.count ?? 0;

    // Act
    const result = await runCli(['queue', 'cancel', 'wo-1']);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('wo-1');
    expect(fixture.current?.hits.count).toBe(hitsBefore);
  });

  it('exits 2 and sends nothing for reprioritise without --priority', async () => {
    // Arrange
    const hitsBefore = fixture.current?.hits.count ?? 0;

    // Act
    const result = await runCli(['queue', 'reprioritise', 'wo-1']);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(fixture.current?.hits.count).toBe(hitsBefore);
  });

  it('shows the live queue as a table with plan slugs', async () => {
    // Arrange
    const cwd = fixture.current?.cwd ?? '';

    // Act
    const result = await runCli(['queue']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wo-1');
    expect(result.stdout).toContain('web-demo');
    expect(readdirSync(join(cwd, 'todos')).sort()).toEqual([
      'cli-05.md',
      'cli-06.md',
    ]);
  });

  it('reads orders/ instead of todos/ on order import once orders/ exists', async () => {
    // Arrange
    const cwd = fixture.current?.cwd ?? '';
    mkdirSync(join(cwd, 'orders'));
    writeFileSync(
      join(cwd, 'orders', 'cli-07.md'),
      READY_TODO.replaceAll('cli-05', 'cli-07'),
    );

    try {
      // Act
      const result = await runCli(['order', 'import', '--dry-run']);

      // Assert
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('dry run: would send 1 file(s)');
      expect(result.stdout).toContain('send cli-07.md');
      expect(result.stdout).not.toContain('send cli-05.md');
    } finally {
      rmSync(join(cwd, 'orders'), { recursive: true, force: true });
    }
  });
});
