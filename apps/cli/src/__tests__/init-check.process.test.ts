import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeScratch, runCli, scratchDir } from './helpers/run-cli';

afterAll(removeScratch);

/** A repository with nothing in it but its root. */
const emptyRepo = (): string => scratchDir('factory-init-repo-');

describe('factory init', () => {
  it('scaffolds .factory/ in a fresh repository and reports the files', async () => {
    const repo = emptyRepo();
    const run = await runCli(scratchDir('factory-init-data-'), [
      'init',
      '--dir',
      repo,
    ]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`initialized ${join(repo, '.factory')}`);
    expect(
      readFileSync(join(repo, '.factory', 'lines', 'feature.yml'), 'utf8'),
    ).toContain('name: feature');
  });

  it('prints the scaffold as JSON with --json', async () => {
    const repo = emptyRepo();
    const run = await runCli(scratchDir('factory-init-data-'), [
      'init',
      '--dir',
      repo,
      '--json',
    ]);

    expect(run.code).toBe(0);
    const body = JSON.parse(run.stdout) as { dir: string; written: string[] };
    expect(body.dir).toBe(join(repo, '.factory'));
    expect(body.written).toContain('lines/fast.yml');
  });

  it('refuses a repository that already has .factory/, and says --force', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);
    const again = await runCli(scratchDir('factory-init-data-'), [
      'init',
      '--dir',
      repo,
    ]);

    expect(again.code).toBe(1);
    expect(again.stderr).toContain('--force');
  });

  it('with --force, rewrites the starter files and keeps the rest', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);
    const mine = join(repo, '.factory', 'lines', 'mine.yml');
    writeFileSync(mine, 'name: mine\n');
    writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), 'x: 1\n');

    const run = await runCli(scratchDir('factory-init-data-'), [
      'init',
      '--dir',
      repo,
      '--force',
    ]);

    expect(run.code).toBe(0);
    expect(readFileSync(mine, 'utf8')).toBe('name: mine\n');
    expect(
      readFileSync(join(repo, '.factory', 'lines', 'feature.yml'), 'utf8'),
    ).toContain('name: feature');
  });
});

describe('factory check --dir', () => {
  it('passes a freshly scaffolded repository', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);

    const run = await runCli(scratchDir('factory-check-data-'), [
      'check',
      '--dir',
      repo,
    ]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('definitions pass');
  });

  it('names the directory to scaffold when a repository has no .factory/', async () => {
    const run = await runCli(scratchDir('factory-check-data-'), [
      'check',
      '--dir',
      emptyRepo(),
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('run factory init');
  });

  it('prints one diagnostic per file for a broken Line, and exits 1', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);
    writeFileSync(
      join(repo, '.factory', 'lines', 'feature.yml'),
      'name: [unclosed\n',
    );

    const run = await runCli(scratchDir('factory-check-data-'), [
      'check',
      '--dir',
      repo,
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('lines/feature.yml');
  });

  it('reports the same errors as JSON with --json', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);
    writeFileSync(
      join(repo, '.factory', 'lines', 'feature.yml'),
      'name: [unclosed\n',
    );

    const run = await runCli(scratchDir('factory-check-data-'), [
      'check',
      '--dir',
      repo,
      '--json',
    ]);

    expect(run.code).toBe(1);
    const body = JSON.parse(run.stdout) as {
      ok: boolean;
      errors: { file: string }[];
    };
    expect(body.ok).toBe(false);
    expect(body.errors.map((error) => error.file)).toContain(
      'lines/feature.yml',
    );
  });

  it('cross-checks declared rules and skills against .nitpick/ when it exists', async () => {
    const repo = emptyRepo();
    await runCli(scratchDir('factory-init-data-'), ['init', '--dir', repo]);
    mkdirSync(join(repo, '.nitpick'));
    writeFileSync(
      join(repo, '.nitpick', 'config.ts'),
      'export default { rules: [] };\n',
    );

    const run = await runCli(scratchDir('factory-check-data-'), [
      'check',
      '--dir',
      repo,
      '--json',
    ]);

    // The scaffold declares rules the empty catalog does not have, so the cross-check reports them.
    expect(run.code).toBe(1);
    const body = JSON.parse(run.stdout) as { errors: unknown[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
