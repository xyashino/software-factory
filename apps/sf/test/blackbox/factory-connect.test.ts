import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 90_000;
const ENROLL_ROUTE = '/api/v1/factories/enroll';
const GOOD_JOIN = 'sf_join_good-join';
const USED_JOIN = 'sf_join_used-join';
const CREDENTIAL_MODE = 0o600;

let hq: Server;
let hqUrl: string;
let enrolled = 0;
const homes: string[] = [];

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const replyJson = (
  status: number,
  body: unknown,
  response: ServerResponse,
): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const sandbox = (): { env: Record<string, string>; configFile: string } => {
  const home = mkdtempSync(join(tmpdir(), 'sf-factory-connect-'));
  homes.push(home);
  const configHome = join(home, 'config');
  return {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: configHome,
    },
    configFile: join(configHome, 'sf', 'factory.json'),
  };
};

const runSf = (
  env: Record<string, string>,
  args: readonly string[],
  stdin?: string,
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
    child.stdin.end(stdin ?? '');
  });

const connect = (
  env: Record<string, string>,
  token: string,
  stdin?: string,
): Promise<CliResult> =>
  runSf(env, ['factory', 'connect', hqUrl, '--token', token], stdin);

beforeAll(async () => {
  hq = createServer((request, response) => {
    if (request.method === 'POST' && request.url === ENROLL_ROUTE) {
      if (request.headers.authorization !== `Bearer ${GOOD_JOIN}`) {
        replyJson(401, { code: 401, type: 'unauthorized' }, response);
        return;
      }
      enrolled += 1;
      replyJson(
        201,
        {
          code: 201,
          factoryId: `factory-${enrolled}`,
          sessionToken: `sf_factory_session_${enrolled}`,
          expiresAt: 4_102_444_800_000,
        },
        response,
      );
      return;
    }
    replyJson(404, { code: 404, message: 'not stubbed' }, response);
  });
  await new Promise<void>((resolve) => {
    hq.listen(0, '127.0.0.1', () => resolve());
  });
  const address = hq.address();
  if (address === null || typeof address === 'string') {
    throw new Error('HQ stub did not bind');
  }
  hqUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  enrolled = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => hq.close(() => resolve()));
  for (const home of homes) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('factory connect', () => {
  it(
    'connect stores the credential in a 0600 file',
    async () => {
      // Arrange
      const { env, configFile } = sandbox();

      // Act
      const result = await connect(env, GOOD_JOIN);

      // Assert
      expect(result.status).toBe(EXIT.ok);
      expect(result.stdout.trim()).toBe('factory connected, id factory-1');
      expect(statSync(configFile).mode & 0o777).toBe(CREDENTIAL_MODE);
      expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({
        url: hqUrl,
        factoryId: 'factory-1',
        sessionToken: 'sf_factory_session_1',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'connect output never shows the join or session token',
    async () => {
      // Arrange
      const { env } = sandbox();

      // Act
      const result = await connect(env, GOOD_JOIN);

      // Assert
      expect(result.stdout).not.toContain(GOOD_JOIN);
      expect(result.stdout).not.toContain('sf_factory_session_');
      expect(result.stderr).not.toContain(GOOD_JOIN);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'connect reads the join token from stdin with --token -',
    async () => {
      // Arrange
      const { env, configFile } = sandbox();

      // Act
      const result = await connect(env, '-', `${GOOD_JOIN}\n`);

      // Assert
      expect(result.status).toBe(EXIT.ok);
      expect(JSON.parse(readFileSync(configFile, 'utf8'))).toMatchObject({
        factoryId: 'factory-1',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'connect again replaces the credential file',
    async () => {
      // Arrange
      const { env, configFile } = sandbox();
      await connect(env, GOOD_JOIN);

      // Act
      const again = await connect(env, GOOD_JOIN);

      // Assert
      expect(again.status).toBe(EXIT.ok);
      expect(JSON.parse(readFileSync(configFile, 'utf8'))).toMatchObject({
        factoryId: expect.stringMatching(/^factory-\d+$/),
      });
      expect(JSON.parse(readFileSync(configFile, 'utf8')).factoryId).not.toBe(
        'factory-1',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a used join token is refused and writes no credential',
    async () => {
      // Arrange
      const { env, configFile } = sandbox();

      // Act
      const result = await connect(env, USED_JOIN);

      // Assert
      expect(result.status).toBe(EXIT.refused);
      expect(result.stderr).toContain('join token rejected');
      expect(() => statSync(configFile)).toThrow();
    },
    TEST_TIMEOUT_MS,
  );
});
