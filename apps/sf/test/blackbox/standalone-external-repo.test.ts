import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SF_BUILD = join(ROOT, 'apps/sf/dist/sf');
const WEB_BUILD = join(ROOT, 'apps/web-demo/dist/server/entry.mjs');
const WEB_DEPS = join(ROOT, 'apps/web-demo/dist/sf-deps/node_modules');
const INSTALL_MJS = join(ROOT, 'scripts/install.mjs');
const INSTALL_SH = join(ROOT, 'scripts/install.sh');
const CI = process.env.CI === 'true';
const COMMAND_TIMEOUT_MS = 30_000;
const ENROLL_TIMEOUT_MS = 20_000;
const POLL_MS = 250;
const PROJECT_ID = 'external-widgets';
const CELL_NAME = 'smoke';
const TODO = `---
status: todo
priority: high
line: standard
---
# ext-01: hello

Body.
`;

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const built = [SF_BUILD, WEB_BUILD, WEB_DEPS].every((path) => existsSync(path));

if (CI && !built) {
  throw new Error('missing sf build in CI: run pnpm build:sf first');
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('no free port'));
          return;
        }
        resolve(address.port);
      });
    });
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!built)('compiled sf in an external repository', () => {
  let base = '';
  let repo = '';
  let sfBin = '';
  let webPort = 0;
  let env: Record<string, string> = {};
  let cell: ChildProcess | undefined;

  const run = (args: readonly string[]): CliResult => {
    const result = spawnSync(sfBin, args, {
      cwd: repo,
      env,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
    });
    return {
      status: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'sf-smoke-'));
    const prefix = join(base, 'prefix');
    const install = spawnSync(
      process.execPath,
      [INSTALL_MJS, '--prefix', prefix],
      {
        env: { PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
      },
    );
    if (install.status !== 0) {
      throw new Error(`install.mjs failed: ${install.stderr}`);
    }
    sfBin = join(prefix, 'bin', 'sf');
    repo = join(base, 'external', 'widgets');
    mkdirSync(repo, { recursive: true });
    spawnSync('git', ['init', '-q', repo]);
    spawnSync('git', [
      '-C',
      repo,
      'remote',
      'add',
      'origin',
      `https://github.com/acme/${PROJECT_ID}.git`,
    ]);
    const serverPort = await freePort();
    webPort = await freePort();
    env = {
      PATH: process.env.PATH ?? '',
      HOME: join(base, 'home'),
      XDG_DATA_HOME: join(base, 'xdg'),
      SF_WEB_DIR: join(prefix, 'share', 'sf', 'web'),
      FACTORY_PORT: String(serverPort),
      FACTORY_URL: `http://127.0.0.1:${serverPort}`,
    };
    mkdirSync(env.HOME as string, { recursive: true });
  });

  afterAll(() => {
    cell?.kill('SIGTERM');
    if (sfBin !== '' && existsSync(sfBin)) {
      run(['web', 'stop']);
      run(['server', 'stop']);
    }
    rmSync(base, { recursive: true, force: true });
  });

  it('installs the binary with install.sh', () => {
    // Arrange
    const prefix = join(base, 'sh-prefix');

    // Act
    const result = spawnSync('bash', [INSTALL_SH], {
      env: { PATH: process.env.PATH ?? '', PREFIX: prefix },
      encoding: 'utf8',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(join(prefix, 'bin', 'sf'))).toBe(true);
  });

  it('scaffolds .factory/ with sf init', () => {
    // Arrange
    // Act
    const result = run(['init']);

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(join(repo, '.factory', 'config.json'))).toBe(true);
  });

  it('starts the server and saves a supervisor token', () => {
    // Arrange
    // Act
    const start = run(['server', 'start']);
    const token = run(['server', 'token', 'create', '--save']);

    // Assert
    expect(start.status).toBe(0);
    expect(token.status).toBe(0);
    expect(existsSync(join(repo, '.factory-local', 'supervisor.token'))).toBe(
      true,
    );
  });

  it('registers the repository as a project', () => {
    // Arrange
    // Act
    const add = run([
      'project',
      'add',
      PROJECT_ID,
      '--repo',
      `https://github.com/acme/${PROJECT_ID}.git`,
    ]);
    const list = run(['project', 'ls', '--json']);

    // Assert
    expect(add.status).toBe(0);
    expect(JSON.parse(list.stdout).projects[0].projectId).toBe(PROJECT_ID);
  });

  it('serves the dashboard from the installed web UI', async () => {
    // Arrange
    // Act
    const start = run(['web', 'start', '--port', String(webPort)]);
    const response = await fetch(`http://127.0.0.1:${webPort}/`);

    // Assert
    expect(start.status).toBe(0);
    expect(response.status).toBe(200);
  });

  it('enrolls a Cell with a cell_join token', async () => {
    // Arrange
    const joinToken = run([
      'token',
      'create',
      '--kind',
      'cell_join',
      '--name',
      CELL_NAME,
    ]);
    cell = spawn(sfBin, ['cell', 'start', '--name', CELL_NAME], {
      cwd: repo,
      env: { ...env, FACTORY_JOIN_TOKEN: joinToken.stdout.trim() },
      stdio: 'ignore',
    });

    // Act
    let listed = '';
    const deadline = Date.now() + ENROLL_TIMEOUT_MS;
    while (!listed.includes(CELL_NAME) && Date.now() < deadline) {
      await sleep(POLL_MS);
      listed = run(['cell', 'list']).stdout;
    }

    // Assert
    expect(joinToken.status).toBe(0);
    expect(listed).toContain(`${PROJECT_ID}:${CELL_NAME}`);
  });

  it('imports todos and shows them in the queue', async () => {
    // Arrange
    const exited = new Promise<void>((resolve) => {
      if (cell === undefined || cell.exitCode !== null) {
        resolve();
        return;
      }
      cell.once('exit', () => resolve());
      cell.kill('SIGTERM');
    });
    await exited;
    mkdirSync(join(repo, 'todos'));
    writeFileSync(join(repo, 'todos', 'ext-01.md'), TODO);

    // Act
    const imported = run(['todos', 'import']);
    const queue = run(['queue']);

    // Assert
    expect(imported.status).toBe(0);
    expect(queue.status).toBe(0);
    expect(queue.stdout).toContain(`${PROJECT_ID}:ext-01`);
  });

  it('stops web and server cleanly', async () => {
    // Arrange
    // Act
    const web = run(['web', 'stop']);
    const server = run(['server', 'stop']);

    // Assert
    expect(web.status).toBe(0);
    expect(server.status).toBe(0);
    await expect(fetch(`http://127.0.0.1:${webPort}/`)).rejects.toThrow();
  });
});
