import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TOKEN = 'sup_hq_names_blackbox';
const OTHER_TOKEN = 'sup_hq_names_other';
const CLOSED_URL = 'http://127.0.0.1:1';
const DEPRECATED_HQ_URL = 'deprecated: FACTORY_URL, use HQ_URL';
const DEPRECATED_HQ_TOKEN = 'deprecated: FACTORY_TOKEN, use HQ_TOKEN';

interface Sandbox {
  home: string;
  cwd: string;
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const dirs: string[] = [];
let server: Server;
let hqUrl: string;

const answer = (request: IncomingMessage, response: ServerResponse): void => {
  const authorized = request.headers.authorization === `Bearer ${TOKEN}`;
  const ok =
    authorized &&
    request.url === '/api/v1/projects' &&
    request.method === 'GET';
  const status = ok ? 200 : authorized ? 404 : 401;
  const body = ok
    ? { code: 200, projects: [] }
    : {
        code: status,
        type: 'error',
        message: authorized ? 'not found' : 'Missing or invalid bearer token',
      };
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const createSandbox = (): Sandbox => {
  const home = mkdtempSync(join(tmpdir(), 'sf-hq-names-'));
  dirs.push(home);
  const cwd = join(home, 'work');
  mkdirSync(cwd);
  return { home, cwd };
};

const runCli = (
  sandbox: Sandbox,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: sandbox.cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: sandbox.home,
        XDG_CONFIG_HOME: join(sandbox.home, 'config'),
        ...env,
      },
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ status: code ?? -1, stdout, stderr }),
    );
    child.stdin.end();
  });

const countOf = (text: string, line: string): number =>
  text.split('\n').filter((row) => row === line).length;

const saveLabTarget = (sandbox: Sandbox): Promise<CliResult> =>
  runCli(sandbox, [
    'hq',
    'connect',
    hqUrl,
    '--name',
    'lab',
    '--token',
    TOKEN,
    '--default',
  ]);

beforeAll(async () => {
  server = createServer(answer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake server has no port');
  }
  hqUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('sf hq', () => {
  it('lists saved targets without any deprecation line', async () => {
    // Arrange
    const sandbox = createSandbox();
    await saveLabTarget(sandbox);

    // Act
    const result = await runCli(sandbox, ['hq', 'target', 'ls']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lab');
    expect(result.stderr).toBe('');
  });

  it('keeps the old target name working and says so once', async () => {
    // Arrange
    const sandbox = createSandbox();
    await saveLabTarget(sandbox);

    // Act
    const result = await runCli(sandbox, ['target', 'ls']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lab');
    expect(result.stderr).toBe('deprecated: use "sf hq target ls"\n');
  });

  it('keeps the old server name working and says so once', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['server', 'stop'], {
      HQ_URL: CLOSED_URL,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server not running');
    expect(result.stderr).toBe('deprecated: use "sf hq stop"\n');
  });

  it('runs the new stop name silently', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['hq', 'stop'], {
      HQ_URL: CLOSED_URL,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server not running');
    expect(result.stderr).toBe('');
  });
});

describe('HQ environment names', () => {
  it('reads HQ_URL and HQ_TOKEN without warning', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['project', 'ls'], {
      HQ_URL: hqUrl,
      HQ_TOKEN: TOKEN,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('lets HQ_URL win over a stale FACTORY_URL', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['project', 'ls'], {
      HQ_URL: hqUrl,
      FACTORY_URL: 'http://127.0.0.1:1',
      HQ_TOKEN: TOKEN,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('deprecated');
  });

  it('falls back to FACTORY_* with one warning per variable and no token value', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['project', 'ls'], {
      FACTORY_URL: hqUrl,
      FACTORY_TOKEN: TOKEN,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(countOf(result.stderr, DEPRECATED_HQ_URL)).toBe(1);
    expect(countOf(result.stderr, DEPRECATED_HQ_TOKEN)).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it('names HQ_TOKEN as the source of a rejected token', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['project', 'ls'], {
      HQ_URL: hqUrl,
      HQ_TOKEN: OTHER_TOKEN,
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('token source: env:HQ_TOKEN');
    expect(result.stderr).toContain(
      'fix: unset HQ_TOKEN, or set it to a token the server accepts',
    );
    expect(result.stderr).not.toContain(OTHER_TOKEN);
  });
});
