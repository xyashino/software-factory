import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const EXIT_ARGUMENT = 2;

const DRAFT_PLAN = {
  planId: 'plan-7',
  projectId: 'software-factory',
  slug: 'standalone-factory',
  title: 'Standalone factory',
  baseBranch: 'main',
  branch: 'factory/standalone-factory',
  branchCommitSha: null,
  state: 'draft',
  failureDetail: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

const FAILED_PLAN = {
  ...DRAFT_PLAN,
  planId: 'plan-8',
  slug: 'broken-plan',
  state: 'failed',
  branchCommitSha: 'abc123',
  failureDetail: 'plan branch failed: push rejected',
};

const COMPLETED_PLAN = {
  ...DRAFT_PLAN,
  planId: 'plan-9',
  slug: 'shipped-plan',
  state: 'completed',
  branchCommitSha: 'def456',
};

const PLANS = { code: 200, items: [DRAFT_PLAN, FAILED_PLAN, COMPLETED_PLAN] };

const RESET_REPLY = {
  code: 200,
  plan: { ...COMPLETED_PLAN, state: 'branching' },
  reset: [{ slug: 'pay-api', state: 'waiting_parent' }],
  skipped: [{ slug: 'pay-done', state: 'delivered' }],
};

const transitioned = (plan: typeof DRAFT_PLAN, state: string) => ({
  code: 200,
  plan: { ...plan, state },
});

interface Hit {
  method: string;
  url: string;
  body: string;
}

interface Fixture {
  cwd: string;
  env: Record<string, string>;
  hits: Hit[];
  server: Server;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const fixture: { current?: Fixture } = {};

const replyFor = (
  method: string,
  path: string,
): { status: number; body: unknown } => {
  if (method === 'GET' && path === '/api/v1/order-plans') {
    return { status: 200, body: PLANS };
  }
  if (method === 'POST' && path === '/api/v1/order-plans/plan-7/transitions') {
    return { status: 200, body: transitioned(DRAFT_PLAN, 'branching') };
  }
  if (method === 'POST' && path === '/api/v1/order-plans/plan-8/transitions') {
    return { status: 200, body: transitioned(FAILED_PLAN, 'branching') };
  }
  if (method === 'POST' && path === '/api/v1/order-plans/plan-9/transitions') {
    return { status: 200, body: RESET_REPLY };
  }
  return {
    status: 404,
    body: { code: 404, type: 'not_found', message: 'not found' },
  };
};

const serveFake = (hits: Hit[]): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const method = request.method ?? 'GET';
        const url = request.url ?? '';
        const body = Buffer.concat(chunks).toString('utf8');
        hits.push({ method, url, body });
        const reply = replyFor(method, new URL(url, 'http://fake').pathname);
        response.statusCode = reply.status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(reply.body));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const createFixture = async (): Promise<Fixture> => {
  const hits: Hit[] = [];
  const server = await serveFake(hits);
  const port = (server.address() as AddressInfo).port;
  const cwd = mkdtempSync(join(tmpdir(), 'factory-plan-cli-'));
  mkdirSync(join(cwd, '.factory'));
  writeFileSync(
    join(cwd, '.factory', 'config.json'),
    JSON.stringify({ project: 'software-factory' }),
  );
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

const hitsNow = (): Hit[] => fixture.current?.hits ?? [];

beforeAll(async () => {
  fixture.current = await createFixture();
});

afterAll(() => {
  fixture.current?.server.close();
});

beforeEach(() => {
  hitsNow().length = 0;
});

describe('plan commands', () => {
  it('lists plans as a table for the repo project', async () => {
    // Arrange
    const expectedUrl = '/api/v1/order-plans?projectId=software-factory';

    // Act
    const result = await runCli(['plan', 'list']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('standalone-factory');
    expect(result.stdout).toContain('factory/standalone-factory');
    expect(hitsNow().map((hit) => hit.url)).toEqual([expectedUrl]);
  });

  it('shows state, branchCommitSha and failureDetail of a plan', async () => {
    // Arrange
    const slug = 'broken-plan';

    // Act
    const result = await runCli(['plan', 'show', slug]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('state=failed');
    expect(result.stdout).toContain('branchCommitSha=abc123');
    expect(result.stdout).toContain(
      'failureDetail=plan branch failed: push rejected',
    );
  });

  it('activates a draft plan to branching', async () => {
    // Arrange
    const slug = 'standalone-factory';

    // Act
    const result = await runCli(['plan', 'activate', slug]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('plan standalone-factory branching');
    const transition = hitsNow().find((hit) => hit.method === 'POST');
    expect(transition?.url).toBe('/api/v1/order-plans/plan-7/transitions');
    expect(JSON.parse(transition?.body ?? '{}')).toEqual({
      action: 'activate',
    });
  });

  it('retries a failed plan from branching', async () => {
    // Arrange
    const slug = 'broken-plan';

    // Act
    const result = await runCli(['plan', 'retry', slug]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('plan broken-plan branching');
    const transition = hitsNow().find((hit) => hit.method === 'POST');
    expect(transition?.url).toBe('/api/v1/order-plans/plan-8/transitions');
    expect(JSON.parse(transition?.body ?? '{}')).toEqual({ action: 'retry' });
  });

  it('refuses plan reset without --yes and sends no request', async () => {
    // Arrange
    const slug = 'shipped-plan';
    const hitsBefore = hitsNow().length;

    // Act
    const result = await runCli(['plan', 'reset', slug]);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('Re-run with --yes');
    expect(hitsNow().length - hitsBefore).toBe(0);
  });

  it('resets a plan with --yes and lists the reset and skipped children', async () => {
    // Arrange
    const slug = 'shipped-plan';

    // Act
    const result = await runCli(['plan', 'reset', slug, '--yes']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('plan shipped-plan branching');
    expect(result.stdout).toContain('reset pay-api waiting_parent');
    expect(result.stdout).toContain('skipped pay-done delivered');
    const transition = hitsNow().find((hit) => hit.method === 'POST');
    expect(transition?.url).toBe('/api/v1/order-plans/plan-9/transitions');
    expect(JSON.parse(transition?.body ?? '{}')).toEqual({ action: 'reset' });
  });

  it('fails with an argument error for an unknown plan slug', async () => {
    // Arrange
    const slug = 'no-such-plan';
    const hitsBefore = hitsNow().length;

    // Act
    const result = await runCli(['plan', 'activate', slug]);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('no plan with slug no-such-plan');
    expect(hitsNow().length - hitsBefore).toBe(1);
    expect(hitsNow().some((hit) => hit.method === 'POST')).toBe(false);
  });
});
