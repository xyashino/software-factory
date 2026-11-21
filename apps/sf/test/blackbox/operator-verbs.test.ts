import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const CYCLE_TOKEN = 'cycle-token-value';
const SUPERVISOR_TOKEN = 'supervisor-token-value';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_ARGUMENT = 2;
const EXIT_UNREACHABLE = 3;

interface Hit {
  method: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Fixture {
  cwd: string;
  url: string;
  server: Server;
}

interface StubCell {
  hits: Hit[];
  reply: Reply;
}

const fixture: { current?: Fixture } = {};
const stub: StubCell = {
  hits: [],
  reply: { status: 200, body: { code: 200 } },
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const startStubCell = (): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const text = await readBody(request);
      stub.hits.push({
        method: request.method ?? '',
        authorization: request.headers.authorization,
        body: JSON.parse(text) as Record<string, unknown>,
      });
      response.statusCode = stub.reply.status;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(stub.reply.body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const closedPortUrl = (): Promise<string> =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(`http://127.0.0.1:${port}/`));
    });
  });

const createFixture = async (): Promise<Fixture> => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-operator-cli-'));
  const server = await startStubCell();
  const { port } = server.address() as AddressInfo;
  return { cwd, url: `http://127.0.0.1:${port}/`, server };
};

const runCli = (
  args: readonly string[],
  env: Record<string, string>,
  stdin = '',
): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env,
      cwd: fixture.current?.cwd,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

const cellEnv = (overrides: Record<string, string | undefined> = {}) => {
  const current = fixture.current as Fixture;
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: current.cwd,
    FACTORY_OPERATOR_URL: current.url,
    FACTORY_CYCLE_TOKEN: CYCLE_TOKEN,
    FACTORY_TOKEN: SUPERVISOR_TOKEN,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }
  return base;
};

const writeFixtureFile = (name: string, text: string): string => {
  const path = join((fixture.current as Fixture).cwd, name);
  writeFileSync(path, text);
  return path;
};

const hitsNow = (): Hit[] => stub.hits;

beforeAll(async () => {
  fixture.current = await createFixture();
});

afterAll(() => {
  fixture.current?.server.close();
});

beforeEach(() => {
  stub.hits.length = 0;
  stub.reply = { status: 200, body: { code: 200 } };
});

describe('factory operator verbs', () => {
  it('sends one done request with the cycle token and prints ok', async () => {
    // Arrange
    const args = ['operator', 'done'];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toBe('ok: true\n');
    expect(hitsNow()).toEqual([
      {
        method: 'POST',
        authorization: `Bearer ${CYCLE_TOKEN}`,
        body: { verb: 'done', token: CYCLE_TOKEN },
      },
    ]);
  });

  it('prints the context the cell returns as JSON', async () => {
    // Arrange
    stub.reply = {
      status: 200,
      body: { code: 200, inputs: ['todo.md'], outputs: [] },
    };

    // Act
    const result = await runCli(['operator', 'context'], cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual({
      code: 200,
      inputs: ['todo.md'],
      outputs: [],
    });
    expect(hitsNow()[0]?.body).toEqual({ verb: 'context', token: CYCLE_TOKEN });
  });

  it('sends the feedback file text on verdict fail', async () => {
    // Arrange
    const feedback = writeFixtureFile('feedback.md', 'Add the missing test');
    const args = ['operator', 'verdict', 'fail', '--feedback', feedback];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_OK);
    expect(hitsNow()[0]?.body).toEqual({
      verb: 'verdict',
      outcome: 'fail',
      feedback: 'Add the missing test',
      token: CYCLE_TOKEN,
    });
  });

  it('reads verdict feedback from stdin when the feedback path is a dash', async () => {
    // Arrange
    const args = ['operator', 'verdict', 'fail', '--feedback', '-'];

    // Act
    const result = await runCli(args, cellEnv(), 'Piped feedback');

    // Assert
    expect(result.code).toBe(EXIT_OK);
    expect(hitsNow()[0]?.body.feedback).toBe('Piped feedback');
  });

  it('refuses verdict fail without --feedback and sends nothing', async () => {
    // Arrange
    const args = ['operator', 'verdict', 'fail'];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(hitsNow()).toEqual([]);
  });

  it('refuses block without --reason and sends nothing', async () => {
    // Arrange
    const handover = writeFixtureFile('handover.md', 'Stopped at review');
    const args = ['operator', 'block', '--handover', handover];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('--reason is required');
    expect(hitsNow()).toEqual([]);
  });

  it('refuses incident restart_from_step without --step and sends nothing', async () => {
    // Arrange
    const report = writeFixtureFile('report.md', '## What happened');
    const args = [
      'operator',
      'incident',
      '--action',
      'restart_from_step',
      '--diagnosis',
      'build failed',
      '--outcome',
      'retried once',
      '--report',
      report,
    ];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('--step is required for restart_from_step');
    expect(hitsNow()).toEqual([]);
  });

  it('refuses an incident action outside the five values and sends nothing', async () => {
    // Arrange
    const report = writeFixtureFile('report.md', '## What happened');
    const args = [
      'operator',
      'incident',
      '--action',
      'nudge',
      '--diagnosis',
      'stuck',
      '--outcome',
      'waited',
      '--report',
      report,
    ];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(hitsNow()).toEqual([]);
  });

  it('prints code and message for a 409 reply, exits 1, and never prints the token', async () => {
    // Arrange
    stub.reply = {
      status: 409,
      body: { code: 409, message: 'job is not running' },
    };

    // Act
    const result = await runCli(['operator', 'done'], cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toBe('409: job is not running\n');
    expect(result.stdout).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain(CYCLE_TOKEN);
  });

  it('exits 3 when the cell cannot be reached', async () => {
    // Arrange
    const url = await closedPortUrl();

    // Act
    const result = await runCli(
      ['operator', 'done'],
      cellEnv({ FACTORY_OPERATOR_URL: url }),
    );

    // Assert
    expect(result.code).toBe(EXIT_UNREACHABLE);
    expect(result.stderr).toContain('cannot reach the Cell');
    expect(result.stderr).not.toContain(CYCLE_TOKEN);
  });

  it('exits 2 and sends nothing when the cycle token is not set', async () => {
    // Arrange
    const env = cellEnv({ FACTORY_CYCLE_TOKEN: undefined });

    // Act
    const result = await runCli(['operator', 'done'], env);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('FACTORY_CYCLE_TOKEN is not set');
    expect(hitsNow()).toEqual([]);
  });

  it('exits 2 and sends nothing when the operator url is not set', async () => {
    // Arrange
    const env = cellEnv({ FACTORY_OPERATOR_URL: undefined });

    // Act
    const result = await runCli(['operator', 'done'], env);

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('FACTORY_OPERATOR_URL is not set');
    expect(hitsNow()).toEqual([]);
  });

  it('refuses an option the verb does not declare, such as --change, and sends nothing', async () => {
    // Arrange
    const report = writeFixtureFile('report.md', '## What happened');
    const args = [
      'operator',
      'incident',
      '--action',
      'cancel',
      '--diagnosis',
      'stuck',
      '--outcome',
      'waited',
      '--report',
      report,
      '--change',
      'file:a.ts=abc',
    ];

    // Act
    const result = await runCli(args, cellEnv());

    // Assert
    expect(result.code).toBe(EXIT_ARGUMENT);
    expect(result.stderr).toContain('unknown option --change');
    expect(hitsNow()).toEqual([]);
  });

  it.each(['answer', 'tell', 'ask', 'resume', 'nudge', 'repair'])(
    'rejects the %s verb, which is not built, and sends nothing',
    async (verb) => {
      // Arrange
      const args = ['operator', verb, 'station', 'note'];

      // Act
      const result = await runCli(args, cellEnv());

      // Assert
      expect(result.code).not.toBe(EXIT_OK);
      expect(hitsNow()).toEqual([]);
    },
  );
});
