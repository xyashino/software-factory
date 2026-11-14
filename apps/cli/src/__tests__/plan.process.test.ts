import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { OrderId, PlanId } from '@repo/factory-core/ids';
import { renderPlanStatus } from '../render/plan';
import { plainPaint } from '../render/paint';

/** The Supervisor CLI entry point, run as a real process with no server running (`--once`). */
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let stopServer: (() => void) | undefined;

afterEach(() => {
  stopServer?.();
  stopServer = undefined;
});

/** A data directory nothing has touched: no server, no database, no plans. */
const freshDataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-plan-'));
  dirs.push(dir);
  return dir;
};

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one `factory` command against a data directory, with the developer's own config kept out. */
const factory = async (dataDir: string, args: string[]): Promise<Run> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FACTORY_CONFIG = join(dataDir, 'no-config.json');
  delete env.FACTORY_DATA_DIR;
  const child = Bun.spawn(
    [process.execPath, CLI, ...args, '--data-dir', dataDir, '--no-color'],
    { stdout: 'pipe', stderr: 'pipe', env },
  );
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

describe('factory plan in a fresh data directory (--once)', () => {
  it('lists no plans in plain mode', async () => {
    const run = await factory(freshDataDir(), ['plan', 'ls']);
    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe('no plans');
  });

  it('lists no plans as an empty JSON array', async () => {
    const run = await factory(freshDataDir(), ['plan', 'ls', '--json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ plans: [] });
  });

  it('refuses a status for a slug that names no plan', async () => {
    const run = await factory(freshDataDir(), ['plan', 'status', 'e2e']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('factory: no plan "e2e"');
  });

  it('refuses a status for a missing slug in JSON mode the same way', async () => {
    const run = await factory(freshDataDir(), [
      'plan',
      'status',
      'e2e',
      '--json',
    ]);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('no plan "e2e"');
  });

  it('names --project in the refusal when the slug is missing there', async () => {
    const run = await factory(freshDataDir(), [
      'plan',
      'status',
      'e2e',
      '--project',
      'demo',
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('no plan "e2e" in project demo');
  });
});

type Detail = RouteResponse<'planDetail'>;

/** One plan in the stacked state: wo-1 merged, wo-2 delivered into factory/wo-1, wo-3 running. */
const stackedDetail = (): Detail => ({
  plan: {
    planId: 'software-factory:plan:e2e' as PlanId,
    projectId: 'software-factory',
    slug: 'e2e',
    branch: 'feat/e2e',
    baseBranch: 'main',
    phase: 'pr_open',
    holder: 'members',
    nextKind: 'wait_external',
    jobKind: null,
    memberCount: 3,
    prUrl: 'https://github.test/pr/9',
    prState: 'open',
    andonReason: null,
    updatedAt: 1,
  },
  members: [
    {
      orderId: 'software-factory:wo-1' as OrderId,
      todoId: 'wo-1',
      after: null,
      state: 'merged',
      status: 'merged',
      baseBranch: 'feat/e2e',
      prUrl: 'https://github.test/pr/1',
      blocker: null,
    },
    {
      orderId: 'software-factory:wo-2' as OrderId,
      todoId: 'wo-2',
      after: 'software-factory:wo-1' as OrderId,
      state: 'active',
      status: 'delivered',
      baseBranch: 'factory/wo-1',
      prUrl: 'https://github.test/pr/2',
      blocker: null,
    },
    {
      orderId: 'software-factory:wo-3' as OrderId,
      todoId: 'wo-3',
      after: 'software-factory:wo-2' as OrderId,
      state: 'active',
      status: 'running',
      baseBranch: 'factory/wo-2',
      prUrl: null,
      blocker: 'waiting_deps',
    },
  ],
});

/**
 * The CLI in remote mode: FACTORY_URL and FACTORY_TOKEN select the HTTP client, and the server answers
 * the two plan routes with the fixture. The token is checked, so a call without it would fail.
 */
const remoteFactory = async (args: string[], detail: Detail): Promise<Run> => {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      if (request.headers.get('authorization') !== 'Bearer tok-plan') {
        return new Response(JSON.stringify({ code: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      const { pathname } = new URL(request.url);
      const body =
        pathname === '/v1/plans'
          ? { plans: [detail.plan] }
          : pathname === `/v1/plans/${encodeURIComponent(detail.plan.planId)}`
            ? detail
            : undefined;
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
          });
    },
  });
  stopServer = () => server.stop(true);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FACTORY_URL = `http://127.0.0.1:${server.port}`;
  env.FACTORY_TOKEN = 'tok-plan';
  env.FACTORY_CONFIG = join(freshDataDir(), 'no-config.json');
  delete env.FACTORY_DATA_DIR;
  const child = Bun.spawn([process.execPath, CLI, ...args, '--no-color'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

describe('factory plan over HTTP (remote mode)', () => {
  it('lists the plan the server returns, in plain mode', async () => {
    const run = await remoteFactory(['plan', 'ls'], stackedDetail());
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('e2e');
    expect(run.stdout).toContain('software-factory');
    expect(run.stdout).toContain('pr_open');
  });

  it('prints the same chain as the renderer, from the server answer', async () => {
    const detail = stackedDetail();
    const run = await remoteFactory(['plan', 'status', 'e2e'], detail);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${renderPlanStatus(detail, plainPaint)}\n`);
    expect(run.stdout).toContain(
      'wo-1 [merged] -> wo-2 [delivered, PR into factory/wo-1] -> wo-3 [running, waiting_deps]',
    );
  });

  it('prints the server answer as JSON with --json', async () => {
    const detail = stackedDetail();
    const run = await remoteFactory(
      ['plan', 'status', 'e2e', '--json'],
      detail,
    );
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(detail);
  });
});
