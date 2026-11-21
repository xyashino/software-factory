import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type IncomingMessage, type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const JOIN_TOKEN = 'sf_join_blackbox0123';
const SUPERVISOR_TOKEN = 'sf_sup_blackbox';

interface Recorded {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const requests: Recorded[] = [];
const projects: unknown[] = [];
const dirs: string[] = [];
let server: Server;
let factoryUrl: string;

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? null : JSON.parse(text);
};

const route = async (
  request: IncomingMessage,
): Promise<{ status: number; body: unknown }> => {
  const body = await readBody(request);
  requests.push({
    method: request.method ?? '',
    url: request.url ?? '',
    authorization: request.headers.authorization,
    body,
  });
  if (request.url === '/api/v1/projects' && request.method === 'POST') {
    const project = { ...(body as object), createdAt: 1, updatedAt: 1 };
    projects.push(project);
    return { status: 201, body: { code: 201, project } };
  }
  if (request.url === '/api/v1/projects' && request.method === 'GET') {
    return { status: 200, body: { code: 200, projects } };
  }
  if (request.url === '/api/v1/tokens' && request.method === 'POST') {
    return {
      status: 201,
      body: {
        code: 201,
        tokenId: 'tok_1',
        kind: 'cell_join',
        token: JOIN_TOKEN,
        scopes: ['cell:join'],
        expiresAt: null,
      },
    };
  }
  return { status: 404, body: { code: 404, type: 'not_found', message: '' } };
};

const runCli = (cwd: string, args: readonly string[]): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(cwd, '..', 'home'),
        FACTORY_URL: factoryUrl,
        FACTORY_TOKEN: SUPERVISOR_TOKEN,
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
  });

const freshRepo = (): string => {
  const base = mkdtempSync(join(tmpdir(), 'sf-init-'));
  dirs.push(base);
  const repo = join(base, 'widgets');
  spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', [
    '-C',
    repo,
    'remote',
    'add',
    'origin',
    'https://github.com/acme/widgets.git',
  ]);
  return repo;
};

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const reply = await route(request);
    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
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

describe('sf init', () => {
  it('writes starter factory files and gitignore entries into a fresh repo', async () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const result = await runCli(repo, ['init']);

    // Assert
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(repo, '.factory/config.json'), 'utf8')),
    ).toEqual({ project: 'widgets' });
    expect(existsSync(join(repo, '.factory/lines/standard.yml'))).toBe(true);
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain(
      '.factory-local/',
    );
  });

  it('skips existing files when run a second time without force', async () => {
    // Arrange
    const repo = freshRepo();
    await runCli(repo, ['init']);

    // Act
    const result = await runCli(repo, ['init']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skip .factory/config.json');
  });
});

describe('sf project', () => {
  it('registers a project on the server without curl', async () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const result = await runCli(repo, [
      'project',
      'add',
      'widgets',
      '--repo',
      'https://github.com/acme/widgets.git',
      '--json',
    ]);

    // Assert
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).project.projectId).toBe('widgets');
    const post = requests.find(
      (call) => call.method === 'POST' && call.url === '/api/v1/projects',
    );
    expect(post?.body).toEqual({
      projectId: 'widgets',
      repoUrl: 'https://github.com/acme/widgets.git',
      defaultBaseBranch: 'main',
      maxRunning: 5,
    });
    expect(post?.authorization).toBe(`Bearer ${SUPERVISOR_TOKEN}`);
  });

  it('registers the origin repo under its name with no arguments', async () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const result = await runCli(repo, ['project', 'add', '--json']);

    // Assert
    expect(result.status).toBe(0);
    const post = requests.filter(
      (call) => call.method === 'POST' && call.url === '/api/v1/projects',
    );
    expect(post.at(-1)?.body).toEqual({
      projectId: 'widgets',
      repoUrl: 'https://github.com/acme/widgets.git',
      defaultBaseBranch: 'main',
      maxRunning: 5,
    });
  });

  it('uses the project id from the repo config with no arguments', async () => {
    // Arrange
    const repo = freshRepo();
    mkdirSync(join(repo, '.factory'));
    writeFileSync(
      join(repo, '.factory/config.json'),
      JSON.stringify({ project: 'widgets-config' }),
    );

    // Act
    const result = await runCli(repo, ['project', 'add']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('project widgets-config registered');
  });

  it('warns and still registers when the explicit id differs from the config', async () => {
    // Arrange
    const repo = freshRepo();
    mkdirSync(join(repo, '.factory'));
    writeFileSync(
      join(repo, '.factory/config.json'),
      JSON.stringify({ project: 'widgets-config' }),
    );

    // Act
    const result = await runCli(repo, ['project', 'add', 'gadgets']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'warning: gadgets differs from .factory/config.json project widgets-config',
    );
    expect(result.stdout).toContain('project gadgets registered');
  });

  it('exits 2 with a clear message outside a repo without arguments', async () => {
    // Arrange
    const outside = mkdtempSync(join(tmpdir(), 'sf-no-repo-'));
    dirs.push(outside);

    // Act
    const result = await runCli(outside, ['project', 'add']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no origin remote, pass --repo <url>');
  });

  it('lists the projects the server holds', async () => {
    // Arrange
    const repo = freshRepo();
    await runCli(repo, [
      'project',
      'add',
      'widgets',
      '--repo',
      'https://github.com/acme/widgets.git',
    ]);

    // Act
    const table = await runCli(repo, ['project', 'ls']);
    const json = await runCli(repo, ['project', 'ls', '--json']);

    // Assert
    expect(table.status).toBe(0);
    expect(table.stdout).toContain('widgets');
    expect(JSON.parse(json.stdout).projects[0].projectId).toBe('widgets');
  });

  it('refuses a project id that is not a slug', async () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const result = await runCli(repo, [
      'project',
      'add',
      'Not A Slug',
      '--repo',
      'https://github.com/acme/widgets.git',
    ]);

    // Assert
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('lowercase slug');
  });
});

describe('sf token', () => {
  it('prints a cell join token the server issues', async () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const result = await runCli(repo, [
      'token',
      'create',
      '--kind',
      'cell_join',
      '--name',
      'worker-1',
    ]);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(JOIN_TOKEN);
  });
});
