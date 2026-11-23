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

const INCIDENTS = {
  code: 200,
  items: [
    {
      incidentId: 'inc-1',
      orderId: 'wo-1',
      reason: 'step_retries_exhausted',
      status: 'open',
      triageOwner: 'operator',
    },
  ],
};

const RESOLVED = {
  code: 200,
  incident: {
    incidentId: 'inc-1',
    status: 'resolved',
    resolutionAction: 'restart_from_step',
  },
  workOrder: { orderId: 'wo-1', state: 'queued' },
};

const ORDER_DETAIL = {
  code: 200,
  order: {
    orderId: 'wo-1',
    lineName: 'feature',
    state: 'blocked',
    priority: 'high',
  },
  steps: [
    {
      stepId: 's-1',
      stepIndex: 0,
      stationId: 'builder',
      kind: 'build',
      state: 'failed',
    },
  ],
  jobs: [
    { jobId: 'job-1', kind: 'build', status: 'failed', cellId: null, epoch: 1 },
  ],
  incidents: [
    { incidentId: 'inc-1', reason: 'step_retries_exhausted', status: 'open' },
  ],
};

const TRANSITIONED = {
  code: 200,
  order: { orderId: 'wo-1', state: 'cancelled' },
};

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
  if (method === 'GET' && path === '/api/v1/incidents') {
    return { status: 200, body: INCIDENTS };
  }
  if (method === 'POST' && path === '/api/v1/incidents/inc-1/resolve') {
    return { status: 200, body: RESOLVED };
  }
  if (method === 'GET' && path === '/api/v1/work-orders/wo-1') {
    return { status: 200, body: ORDER_DETAIL };
  }
  if (method === 'POST' && path === '/api/v1/work-orders/wo-1/transitions') {
    return { status: 200, body: TRANSITIONED };
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
        hits.push({
          method,
          url,
          body: Buffer.concat(chunks).toString('utf8'),
        });
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
  const cwd = mkdtempSync(join(tmpdir(), 'factory-incidents-cli-'));
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

describe('incident and order commands', () => {
  it('lists incidents as a table with the repo project', async () => {
    // Arrange
    const expectedUrl = '/api/v1/incidents?projectId=software-factory';

    // Act
    const result = await runCli(['incident', 'list']);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('triage owner');
    expect(result.stdout).toContain('inc-1');
    expect(result.stdout).toContain('step_retries_exhausted');
    expect(hitsNow().map((hit) => hit.url)).toEqual([expectedUrl]);
  });

  it('resolves an incident with restart_from_step and the given step index', async () => {
    // Arrange
    const args = [
      'incident',
      'resolve',
      'inc-1',
      '--action',
      'restart_from_step',
      '--step',
      '2',
    ];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'incident inc-1 resolved, order wo-1 queued',
    );
    expect(hitsNow()).toEqual([
      {
        method: 'POST',
        url: '/api/v1/incidents/inc-1/resolve',
        body: JSON.stringify({ action: 'restart_from_step', stepIndex: 2 }),
      },
    ]);
  });

  it('refuses restart_from_step without --step and sends no request', async () => {
    // Arrange
    const args = [
      'incident',
      'resolve',
      'inc-1',
      '--action',
      'restart_from_step',
    ];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('restart_from_step requires --step');
    expect(hitsNow()).toEqual([]);
  });

  it('refuses an unknown resolve action and sends no request', async () => {
    // Arrange
    const args = ['incident', 'resolve', 'inc-1', '--action', 'explode'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(hitsNow()).toEqual([]);
  });

  it('refuses --report and sends no request, since the server has no report field', async () => {
    // Arrange
    const args = [
      'incident',
      'resolve',
      'inc-1',
      '--action',
      'escalate',
      '--report',
      'report.md',
    ];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('--report is not accepted');
    expect(hitsNow()).toEqual([]);
  });

  it('shows one work order with its steps, jobs and incidents', async () => {
    // Arrange
    const args = ['order', 'show', 'wo-1'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wo-1 blocked line=feature priority=high');
    expect(result.stdout).toContain('builder');
    expect(result.stdout).toContain('job-1');
    expect(result.stdout).toContain('inc-1');
  });

  it('prints the raw body of order show with --json', async () => {
    // Arrange
    const args = ['order', 'show', 'wo-1', '--json'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(ORDER_DETAIL);
  });

  it('refuses order cancel without --yes and sends no request', async () => {
    // Arrange
    const args = ['order', 'cancel', 'wo-1'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('Re-run with --yes');
    expect(hitsNow()).toEqual([]);
  });

  it('cancels a work order with --yes', async () => {
    // Arrange
    const args = ['order', 'cancel', 'wo-1', '--yes'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wo-1 cancelled');
    expect(hitsNow()).toEqual([
      {
        method: 'POST',
        url: '/api/v1/work-orders/wo-1/transitions',
        body: JSON.stringify({ action: 'cancel' }),
      },
    ]);
  });

  it('resumes a work order without needing --yes', async () => {
    // Arrange
    const args = ['order', 'resume', 'wo-1'];

    // Act
    const result = await runCli(args);

    // Assert
    expect(result.code).toBe(0);
    expect(hitsNow()[0]?.body).toBe(JSON.stringify({ action: 'resume' }));
  });
});
