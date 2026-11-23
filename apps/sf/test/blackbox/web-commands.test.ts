import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const PROJECT_ID = 'software-factory';
const WEB_ENTRY_SOURCE = `
import { createServer } from 'node:http';
createServer((request, response) => {
  response.end(JSON.stringify({
    projectId: process.env.FACTORY_PROJECT_ID,
    dataDir: process.env.FACTORY_DATA_DIR,
  }));
}).listen(Number(process.env.PORT), process.env.HOST);
`;

interface Sandbox {
  home: string;
  dataDir: string;
  webPort: number;
  env: Record<string, string>;
}

const sandboxes: Sandbox[] = [];

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
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

const createSandbox = async (): Promise<Sandbox> => {
  const home = mkdtempSync(join(tmpdir(), 'factory-web-cli-'));
  const serverPort = await freePort();
  const webPort = await freePort();
  mkdirSync(join(home, '.factory'), { recursive: true });
  writeFileSync(
    join(home, '.factory', 'config.json'),
    JSON.stringify({ project: PROJECT_ID }),
  );
  mkdirSync(join(home, 'web', 'server'), { recursive: true });
  writeFileSync(join(home, 'web', 'server', 'entry.mjs'), WEB_ENTRY_SOURCE);
  const sandbox: Sandbox = {
    home,
    dataDir: join(home, 'xdg', 'sf'),
    webPort,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_DATA_HOME: join(home, 'xdg'),
      SF_WEB_DIR: join(home, 'web'),
      FACTORY_PORT: String(serverPort),
      FACTORY_URL: `http://127.0.0.1:${serverPort}`,
    },
  };
  sandboxes.push(sandbox);
  return sandbox;
};

const runSf = (sandbox: Sandbox, args: readonly string[]) =>
  spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: sandbox.home,
    env: sandbox.env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

const webPidFileOf = (sandbox: Sandbox): string =>
  join(sandbox.dataDir, 'web.pid');

const webUrlOf = (sandbox: Sandbox): string =>
  `http://127.0.0.1:${sandbox.webPort}/`;

afterAll(() => {
  for (const sandbox of sandboxes) {
    runSf(sandbox, ['web', 'stop']);
    runSf(sandbox, ['server', 'stop']);
    rmSync(sandbox.home, { recursive: true, force: true });
  }
});

describe('sf web start, status and stop', () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    sandbox = await createSandbox();
  });

  it('serves live data from the running server without manual env', async () => {
    // Arrange
    runSf(sandbox, ['server', 'start']);

    // Act
    const result = runSf(sandbox, [
      'web',
      'start',
      '--port',
      String(sandbox.webPort),
    ]);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('web started, pid');
    expect(result.stdout).toContain(`url http://127.0.0.1:${sandbox.webPort}`);
    expect(existsSync(webPidFileOf(sandbox))).toBe(true);
    const response = await fetch(webUrlOf(sandbox));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectId: PROJECT_ID,
      dataDir: sandbox.dataDir,
    });
  });

  it('reports the running web UI as JSON from status', () => {
    // Arrange
    // Act
    const result = runSf(sandbox, [
      'web',
      'status',
      '--port',
      String(sandbox.webPort),
      '--json',
    ]);

    // Assert
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      running: true,
      url: `http://127.0.0.1:${sandbox.webPort}`,
    });
  });

  it('refuses a second web start while the first web UI runs', () => {
    // Arrange
    // Act
    const result = runSf(sandbox, [
      'web',
      'start',
      '--port',
      String(sandbox.webPort),
    ]);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('web already running');
  });

  it('stops the web UI and removes web.pid', async () => {
    // Arrange
    // Act
    const result = runSf(sandbox, ['web', 'stop']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('web stopped');
    expect(existsSync(webPidFileOf(sandbox))).toBe(false);
    await expect(fetch(webUrlOf(sandbox))).rejects.toThrow();
  });

  it('exits unreachable and names sf hq start when the server is down', async () => {
    // Arrange
    const serverDown = await createSandbox();

    // Act
    const result = runSf(serverDown, [
      'web',
      'start',
      '--port',
      String(serverDown.webPort),
    ]);

    // Assert
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('sf hq start');
    expect(existsSync(webPidFileOf(serverDown))).toBe(false);
  });
});
