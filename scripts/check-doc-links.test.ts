import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const CHECKER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'check-doc-links.ts',
);
const fixtures: string[] = [];

after(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
  fixtures.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function runChecker(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [CHECKER, root], {
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('docs:check', () => {
  it('passes when every relative link resolves', () => {
    const root = repoWith({
      'README.md': 'See [guide](docs/guide.md).',
      'docs/guide.md': 'Back to [home](../README.md).',
    });

    const { status, output } = runChecker(root);

    assert.equal(status, 0);
    assert.match(output, /no dead relative doc links/);
  });

  it('fails and names file and link when a relative link is missing', () => {
    const root = repoWith({
      'docs/guide.md': 'Gone: [old](./missing.md).',
    });

    const { status, output } = runChecker(root);

    assert.equal(status, 1);
    assert.match(output, /docs\/guide\.md -> \.\/missing\.md/);
  });

  it('accepts an anchored link when the target file exists', () => {
    const root = repoWith({
      'docs/guide.md': 'See [setup](setup.md#install).',
      'docs/setup.md': '# Install',
    });

    const { status } = runChecker(root);

    assert.equal(status, 0);
  });

  it('fails an anchored link when the target file is missing', () => {
    const root = repoWith({
      'docs/guide.md': 'See [setup](setup.md#install).',
    });

    const { status, output } = runChecker(root);

    assert.equal(status, 1);
    assert.match(output, /docs\/guide\.md -> setup\.md#install/);
  });

  it('ignores external, mailto, absolute and pure anchor links', () => {
    const root = repoWith({
      'docs/guide.md': [
        '[site](https://example.test/page)',
        '[mail](mailto:team@example.test)',
        '[top](#top)',
        '[root](/docs/missing.md)',
      ].join('\n'),
    });

    const { status } = runChecker(root);

    assert.equal(status, 0);
  });

  it('ignores links inside fenced code blocks', () => {
    const root = repoWith({
      'docs/guide.md': ['```md', '[example](not-here.md)', '```'].join('\n'),
    });

    const { status } = runChecker(root);

    assert.equal(status, 0);
  });

  it('ignores link syntax written inside inline code spans', () => {
    const root = repoWith({
      'docs/guide.md': 'Write `[id](id.md)` to link a rule.',
    });

    const { status } = runChecker(root);

    assert.equal(status, 0);
  });

  it('checks app and package READMEs', () => {
    const root = repoWith({
      'apps/web/README.md': 'Run [config](config.md).',
      'packages/lib/README.md': 'Read [api](api.md).',
    });

    const { status, output } = runChecker(root);

    assert.equal(status, 1);
    assert.match(output, /apps\/web\/README\.md -> config\.md/);
    assert.match(output, /packages\/lib\/README\.md -> api\.md/);
  });

  it('skips decisions and todos, which may link removed files', () => {
    const root = repoWith({
      'decisions/entry.md': '[old](gone.md)',
      'todos/task.md': '[old](gone.md)',
    });

    const { status } = runChecker(root);

    assert.equal(status, 0);
  });
});
