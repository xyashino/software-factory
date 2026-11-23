import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const EXIT_ARGUMENT = 2;
const STACK_MARKERS = [
  'at runCommand',
  '/$bunfs/',
  'CLIError:',
  'ZodError',
  'code: "E_',
  'at async',
];

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

const REJECTED: [string[], string][] = [
  [['cell', 'list', '--bogus'], 'unknown option --bogus'],
  [['cell', 'list', 'extra'], 'unexpected argument extra'],
  [['cell', 'start', '--bogus'], 'unknown option --bogus'],
  [['cell', 'stop', '--id'], '--id requires a value'],
  [['cell', 'stop', '--id='], '--id requires a value'],
  [['incident', '--bogus', 'x'], 'unknown option --bogus'],
  [['incident', 'list', '--bogus'], 'unknown option --bogus'],
  [['incident', 'resolve', 'inc-1', 'extra'], 'unexpected argument extra'],
  [['incident', 'resolve', ''], 'incident id is required'],
  [['queue', '--bogus', 'x'], 'unknown option --bogus'],
  [['queue', 'list', '--state'], '--state requires a value'],
  [['queue', 'pause', '--bogus', 'ord-1'], 'unknown option --bogus'],
  [['order', 'show', '--bogus', 'ord-1'], 'unknown option --bogus'],
  [['order', 'show', 'ord-1', 'extra'], 'unexpected argument extra'],
  [['order', 'resume', ''], 'work order id is required'],
  [['order', 'cancel', 'a', 'b', '--yes'], 'unexpected argument b'],
  [
    ['project', 'add', 'p', '--repo', 'u', '--max-running', 'abc'],
    '--max-running takes a whole number at least 1, not "abc"',
  ],
  [
    ['project', 'add', 'p', '--repo', 'u', '--max-running', '0'],
    '--max-running takes a whole number at least 1, not "0"',
  ],
  [['project', 'add', 'p', '--repo'], '--repo requires a value'],
  [['project', 'add', '', '--repo', 'u'], 'project id is required'],
  [['project', 'ls', 'extra'], 'unexpected argument extra'],
  [['server', 'start', '--bogus'], 'unknown option --bogus'],
  [['server', 'start', 'extra'], 'unexpected argument extra'],
  [['server', 'stop', '--bogus'], 'unknown option --bogus'],
  [['server', 'token', 'create', '--bogus'], 'unknown option --bogus'],
  [['todos', 'import', '--bogus'], 'unknown option --bogus'],
  [['todos', 'import', '--dir'], '--dir requires a value'],
  [['todos', 'export', 'extra'], 'unexpected argument extra'],
  [['token', 'create', '--kind', '--name', 'x'], '--kind requires a value'],
  [
    ['token', 'create', '--kind', 'supervisor', '--bogus'],
    'unknown option --bogus',
  ],
  [['watch', '--bogus'], 'unknown option --bogus'],
  [['watch', 'extra'], 'unexpected argument extra'],
  [
    ['watch', '--after', 'abc'],
    '--after takes a whole number at least 0, not "abc"',
  ],
  [['watch', '--after'], '--after requires a value'],
  [['web', 'start', '--bogus'], 'unknown option --bogus'],
  [
    ['web', 'start', '--port', 'abc'],
    '--port takes a whole number between 1 and 65535, not "abc"',
  ],
  [
    ['web', 'status', '--port', '99999'],
    '--port takes a whole number between 1 and 65535, not "99999"',
  ],
  [['web', 'stop', 'extra'], 'unexpected argument extra'],
  [['init', '--bogus'], 'unknown option --bogus'],
  [['init', '--project'], '--project requires a value'],
  [['init', 'extra'], 'unexpected argument extra'],
];

let home = '';
let work = '';
let hits = 0;
let backend: Server;
let baseEnv: Record<string, string> = {};

const runSf = (args: string[], env: Record<string, string> = {}) =>
  new Promise<Result>((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      {
        cwd: work,
        env: { ...baseEnv, ...env },
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });

const expectRejected = (result: Result, message: string): void => {
  expect(result.code).toBe(EXIT_ARGUMENT);
  expect(result.stderr).toBe(`${message}\n`);
  expect(result.stdout).toBe('');
  for (const marker of STACK_MARKERS) {
    expect(result.stderr).not.toContain(marker);
  }
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'factory-validation-home-'));
  work = mkdtempSync(join(tmpdir(), 'factory-validation-work-'));
  backend = createServer((_request, response) => {
    hits += 1;
    response.statusCode = 500;
    response.end();
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const { port } = backend.address() as AddressInfo;
  mkdirSync(join(home, 'xdg'), { recursive: true });
  baseEnv = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_DATA_HOME: join(home, 'xdg'),
    FACTORY_URL: `http://127.0.0.1:${port}`,
  };
});

afterAll(async () => {
  await new Promise((resolve) => backend.close(resolve));
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

describe('sf argument validation', () => {
  it.each(REJECTED)('rejects %j', async (args, message) => {
    // Act
    const result = await runSf(args);

    // Assert
    expectRejected(result, message);
  });

  it('never reaches the server or writes files for a rejected command', async () => {
    // Arrange
    const before = hits;

    // Act
    for (const [args] of REJECTED) {
      await runSf(args);
    }

    // Assert
    expect(hits).toBe(before);
    expect(readdirSync(work)).toEqual([]);
    expect(readdirSync(join(home, 'xdg'))).toEqual([]);
  });

  it('reports the unknown flag instead of an unknown command', async () => {
    // Act
    const result = await runSf(['incident', '--unknown', 'x']);

    // Assert
    expect(result.stderr).not.toContain('Unknown command');
    expect(result.stderr).toBe('unknown option --unknown\n');
  });

  it('rejects a bad FACTORY_PORT without starting the server', async () => {
    // Act
    const result = await runSf(['server', 'start'], { FACTORY_PORT: 'abc' });

    // Assert
    expectRejected(
      result,
      'FACTORY_PORT takes a whole number between 1 and 65535, not "abc"',
    );
  });

  it('still takes declared flags and positionals', async () => {
    // Act
    const result = await runSf(['cell', 'list', '--json']);

    // Assert
    expect(result.stderr).not.toContain('unknown option');
    expect(result.stderr).not.toContain('unexpected argument');
  });
});
