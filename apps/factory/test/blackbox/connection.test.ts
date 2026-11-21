import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const PRIVATE_MODE = 0o600;
const TOKEN = 'sup_connection_blackbox';
const STALE_TOKEN = 'sup_stale_blackbox';

interface Sandbox {
  home: string;
  cwd: string;
  configPath: string;
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const dirs: string[] = [];
let server: Server;
let factoryUrl: string;

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
  const home = mkdtempSync(join(tmpdir(), 'sf-connection-'));
  dirs.push(home);
  const cwd = join(home, 'work');
  mkdirSync(cwd);
  return { home, cwd, configPath: join(home, 'config', 'sf', 'config.json') };
};

const runCli = (
  sandbox: Sandbox,
  args: readonly string[],
  options: { env?: Record<string, string>; stdin?: string } = {},
): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: sandbox.cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: sandbox.home,
        XDG_CONFIG_HOME: join(sandbox.home, 'config'),
        ...options.env,
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
    child.stdin.end(options.stdin ?? '');
  });

const connectLab = (
  sandbox: Sandbox,
  extra: string[] = [],
): Promise<CliResult> =>
  runCli(sandbox, [
    'connect',
    factoryUrl,
    '--name',
    'lab',
    '--token',
    TOKEN,
    ...extra,
  ]);

beforeAll(async () => {
  server = createServer(answer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake server has no port');
  }
  factoryUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('sf connect', () => {
  it('saves the target with an owner-only config and never prints the token', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await connectLab(sandbox, ['--default']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`connected lab ${factoryUrl} (active)`);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
    expect(statSync(sandbox.configPath).mode & 0o777).toBe(PRIVATE_MODE);
    expect(JSON.parse(readFileSync(sandbox.configPath, 'utf8'))).toEqual({
      current: 'lab',
      targets: { lab: { url: factoryUrl, token: TOKEN } },
    });
  });

  it('reads the token from stdin with --token-stdin', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(
      sandbox,
      ['connect', factoryUrl, '--name', 'piped', '--token-stdin'],
      { stdin: `${TOKEN}\n` },
    );

    // Assert
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(sandbox.configPath, 'utf8')).targets.piped.token,
    ).toBe(TOKEN);
  });

  it('refuses a token the factory rejects and saves nothing', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, [
      'connect',
      factoryUrl,
      '--name',
      'lab',
      '--token',
      STALE_TOKEN,
    ]);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`token rejected by ${factoryUrl}`);
    expect(() => readFileSync(sandbox.configPath)).toThrow();
  });

  it('exits 2 without a token when no terminal is attached', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['connect', factoryUrl]);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('token is required');
  });
});

describe('sf target', () => {
  it('lists, switches and removes saved targets', async () => {
    // Arrange
    const sandbox = createSandbox();
    await connectLab(sandbox, ['--default']);
    await runCli(sandbox, [
      'connect',
      factoryUrl,
      '--name',
      'other',
      '--token',
      TOKEN,
    ]);

    // Act
    const switched = await runCli(sandbox, ['target', 'use', 'other']);
    const listed = await runCli(sandbox, ['target', 'ls']);
    const removed = await runCli(sandbox, ['target', 'rm', 'other']);

    // Assert
    expect(switched.stdout).toContain('active target other');
    expect(listed.stdout).toMatch(/other\s+\S+\s+\*/);
    expect(removed.status).toBe(0);
    expect(JSON.parse(readFileSync(sandbox.configPath, 'utf8'))).toEqual({
      current: null,
      targets: { lab: { url: factoryUrl, token: TOKEN } },
    });
  });

  it('refuses to select a target that is not saved', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['target', 'use', 'ghost']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no target named ghost');
  });
});

describe('sf connection precedence and 401 diagnostics', () => {
  it('runs commands against the active saved target without env', async () => {
    // Arrange
    const sandbox = createSandbox();
    await connectLab(sandbox, ['--default']);

    // Act
    const result = await runCli(sandbox, ['project', 'ls']);

    // Assert
    expect(result.status).toBe(0);
  });

  it('names the target, token source and recovery command on a 401', async () => {
    // Arrange
    const sandbox = createSandbox();
    await connectLab(sandbox, ['--default']);

    // Act
    const result = await runCli(sandbox, ['project', 'ls'], {
      env: { FACTORY_TOKEN: STALE_TOKEN },
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('401: Missing or invalid bearer token');
    expect(result.stderr).toContain(`target: ${factoryUrl} (config:lab)`);
    expect(result.stderr).toContain('token source: env:FACTORY_TOKEN');
    expect(result.stderr).toContain(
      'fix: sf server token create --save --global',
    );
    expect(result.stderr).not.toContain(STALE_TOKEN);
  });

  it('prefers the repo token file over the saved target token', async () => {
    // Arrange
    const sandbox = createSandbox();
    await connectLab(sandbox, ['--default']);
    mkdirSync(join(sandbox.cwd, '.factory-local'));
    writeFileSync(
      join(sandbox.cwd, '.factory-local', 'supervisor.token'),
      `${STALE_TOKEN}\n`,
    );

    // Act
    const result = await runCli(sandbox, ['project', 'ls']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'token source: repo:.factory-local/supervisor.token',
    );
  });

  it('explains how to connect when no token is stored at all', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['project', 'ls']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'No token stored for http://127.0.0.1:7070',
    );
    expect(result.stderr).toContain(
      'fix: sf server token create --save --global',
    );
  });
});

describe('sf unknown flags', () => {
  it('rejects cell list --all with exit 2', async () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = await runCli(sandbox, ['cell', 'list', '--all']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option --all');
  });
});
