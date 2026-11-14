import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/** The Supervisor CLI entry point, run as a real process with no server running (`--once`). */
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A data directory nothing has touched: no server, no database, no seeded project. */
const freshDataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-project-'));
  dirs.push(dir);
  return dir;
};

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one `factory` command against a data directory, with the developer's own config kept out. */
const factory = async (dataDir: string, args: string[]): Promise<Run> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FACTORY_CONFIG = join(dataDir, 'no-config.json');
  delete env.FACTORY_DATA_DIR;
  const child = Bun.spawn(
    [process.execPath, CLI, ...args, '--data-dir', dataDir, '--no-color'],
    { stdout: 'pipe', stderr: 'pipe', env },
  );
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

describe('factory project in a fresh data directory', () => {
  it('registers a project with add alone, then lists, changes and removes it', async () => {
    const dataDir = freshDataDir();

    const added = await factory(dataDir, [
      'project',
      'add',
      'demo',
      '--repo',
      'https://example.test/demo.git',
      '--max-running',
      '3',
    ]);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('added demo');
    expect(added.stderr).toContain(
      'a Cell serves demo only if its config lists it',
    );

    const listed = await factory(dataDir, ['project', 'ls']);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('demo');
    expect(listed.stdout).toContain('https://example.test/demo.git');

    const changed = await factory(dataDir, [
      'project',
      'set',
      'demo',
      '--max-running',
      '4',
    ]);
    expect(changed.code).toBe(0);
    expect(changed.stdout).toContain('updated demo');

    const removed = await factory(dataDir, ['project', 'rm', 'demo']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('removed demo');

    const empty = await factory(dataDir, ['project', 'ls']);
    expect(empty.stdout).toContain('no projects');
  }, 60_000);

  it('prints the stored record as JSON with --json', async () => {
    const dataDir = freshDataDir();

    const added = await factory(dataDir, [
      'project',
      'add',
      'demo',
      '--repo',
      'https://example.test/demo.git',
      '--json',
    ]);

    expect(JSON.parse(added.stdout)).toEqual({
      project: {
        projectId: 'demo',
        repoUrl: 'https://example.test/demo.git',
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      },
    });
  }, 60_000);

  it('refuses a second add of the same id, and a base branch change with an open order, with exit 1', async () => {
    const dataDir = freshDataDir();
    await factory(dataDir, [
      'project',
      'add',
      'demo',
      '--repo',
      'https://example.test/demo.git',
    ]);

    const duplicate = await factory(dataDir, [
      'project',
      'add',
      'demo',
      '--repo',
      'https://example.test/demo.git',
    ]);

    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('project demo is already registered');
  }, 60_000);

  it('refuses set with no field and a bad dependency policy before it calls the runtime', async () => {
    const dataDir = freshDataDir();

    const noField = await factory(dataDir, ['project', 'set', 'demo']);
    const badPolicy = await factory(dataDir, [
      'project',
      'add',
      'demo',
      '--repo',
      'https://example.test/demo.git',
      '--dep-policy',
      'shipped',
    ]);

    expect(noField.code).toBe(1);
    expect(noField.stderr).toContain('project set needs at least one of');
    expect(badPolicy.code).toBe(1);
    expect(badPolicy.stderr).toContain(
      '--dep-policy must be delivered or merged',
    );
  }, 60_000);
});
