import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeHttpAnswer,
  encodeHttpCall,
} from '@repo/factory-core/contracts/http-codec';
import {
  WireFailure,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import type { RouteName } from '@repo/factory-core/contracts/routes';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { createHttpApp } from '../http/app';
import type { HttpListener } from '../http/listener';
import {
  httpClient,
  listenLocal,
  LOCAL_TEST_TOKEN,
} from '../testing/local-http';

/**
 * The project registry answers the same over local HTTP, remote HTTP and `--once` (RULES §6.5).
 * Each transport runs the same steps against a fresh data directory with no seeding, and the answers
 * must be equal. The scenario is add, list, set, a duplicate add, a board read, two refusals and a not-found.
 */

/** The server entry point, run as a real process for `--once`. */
const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));

interface Step {
  route: RouteName;
  request: unknown;
}

/** One answer, as a client sees it: the response, or the wire error of a refusal. */
type Outcome =
  { ok: true; response: unknown } | { ok: false; error: WireError };

let root: string;
const repo = 'https://example.test/software-factory.git';
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-registry-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A data directory no earlier run touched: nothing is seeded and nothing is registered. */
const freshDataDir = (transport: string): string => {
  counter += 1;
  return join(root, `${transport}-${counter}`);
};

const scenario = (repoUrl: string): Step[] => {
  const demo = {
    projectId: 'demo',
    repoUrl,
    baseBranch: 'main',
    maxRunning: 2,
    depPolicy: 'delivered',
  };
  return [
    { route: 'projectAdd', request: demo },
    { route: 'projectList', request: {} },
    { route: 'projectSet', request: { projectId: 'demo', maxRunning: 3 } },
    { route: 'projectAdd', request: demo },
    { route: 'board', request: {} },
    {
      route: 'projectSet',
      request: { projectId: 'demo', baseBranch: 'develop' },
    },
    { route: 'projectRemove', request: { projectId: 'demo' } },
    { route: 'projectSet', request: { projectId: 'ghost', maxRunning: 2 } },
    { route: 'projectList', request: {} },
  ];
};

const openFresh = (dataDir: string): OpenedRuntime => openRuntime({ dataDir });

/** Runs a call and turns a refusal into its wire error; any other failure is a test failure. */
const outcomeOf = async (call: () => Promise<unknown>): Promise<Outcome> => {
  try {
    return { ok: true, response: await call() };
  } catch (error) {
    if (error instanceof WireFailure) return { ok: false, error: error.error };
    throw error;
  }
};

/** The steps over local HTTP, served the way factory-server serves it (the local supervisor token). */
const overLocal = async (steps: Step[]): Promise<Outcome[]> => {
  const dataDir = freshDataDir('local');
  const opened = openFresh(dataDir);
  await opened.runtime.start();
  const listener: HttpListener = listenLocal(opened.runtime);
  const client = httpClient(listener.url, LOCAL_TEST_TOKEN);
  try {
    const outcomes: Outcome[] = [];
    for (const step of steps) {
      outcomes.push(
        await outcomeOf(() => client.call(step.route, step.request as never)),
      );
    }
    return outcomes;
  } finally {
    await listener.stop();
    opened.close();
  }
};

/** The steps over remote HTTP, through the Hono app with a supervisor token (PROTOCOL §3). */
const overHttp = async (steps: Step[]): Promise<Outcome[]> => {
  const opened = openFresh(freshDataDir('http'));
  await opened.runtime.start();
  const app = createHttpApp(opened.runtime);
  const { token } = await opened.runtime.remote.createSupervisorToken('dev');
  try {
    const outcomes: Outcome[] = [];
    for (const step of steps) {
      const call = encodeHttpCall(step.route, step.request as never);
      const response = await app.request(call.path, {
        method: call.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(call.json !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
        },
        body: call.json,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      outcomes.push(
        await outcomeOf(async () =>
          decodeHttpAnswer(
            step.route,
            step.request as never,
            response.status,
            bytes,
          ),
        ),
      );
    }
    return outcomes;
  } finally {
    opened.close();
  }
};

/** The steps through `factory-server --once`: one process per step, each takes the writer lock. */
const overOnce = async (steps: Step[]): Promise<Outcome[]> => {
  const dataDir = freshDataDir('once');
  const outcomes: Outcome[] = [];
  for (const step of steps) {
    const child = Bun.spawn(['bun', MAIN, '--once', '--data-dir', dataDir], {
      env: { ...process.env, FACTORY_DATA_DIR: '' },
      stdin: new Blob([
        JSON.stringify({ route: step.route, request: step.request }),
      ]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await child.exited;
    const body = JSON.parse(await new Response(child.stdout).text()) as
      { ok: true; response: unknown } | { ok: false; error: WireError };
    outcomes.push(
      body.ok
        ? { ok: true, response: body.response }
        : { ok: false, error: body.error },
    );
  }
  return outcomes;
};

describe('project registry over the three transports', () => {
  it('answers the same steps the same way over local HTTP, remote HTTP and --once', async () => {
    const steps = scenario(repo);

    const local = await overLocal(steps);
    const http = await overHttp(steps);
    const once = await overOnce(steps);

    expect(http).toEqual(local);
    expect(once).toEqual(local);
  }, 120_000);

  it('registers, changes and refuses as the PROTOCOL §3.1 rules say', async () => {
    const outcomes = await overLocal(scenario(repo));
    const refusal = (index: number) => {
      const outcome = outcomes[index];
      if (!outcome || outcome.ok) throw new Error(`step ${index} succeeded`);
      return outcome.error;
    };

    expect(outcomes[0]).toMatchObject({
      ok: true,
      response: { project: { projectId: 'demo', maxRunning: 2 } },
    });
    expect(outcomes[2]).toMatchObject({
      ok: true,
      response: { project: { projectId: 'demo', maxRunning: 3 } },
    });
    expect(refusal(3).code).toBe('precondition');
    expect(outcomes[5]).toMatchObject({
      ok: true,
      response: { project: { projectId: 'demo', baseBranch: 'develop' } },
    });
    expect(outcomes[6]).toMatchObject({ ok: true });
    expect(refusal(7)).toEqual({ code: 'not_found' });
    expect(outcomes[8]).toMatchObject({
      ok: true,
      response: { projects: [] },
    });
  }, 60_000);
});
