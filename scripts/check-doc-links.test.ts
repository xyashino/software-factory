import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SCRIPT = fileURLToPath(new URL('./check-doc-links.ts', import.meta.url));

type Repo = Readonly<Record<string, string>>;

const runCheck = (repo: Repo) => {
  const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
  try {
    for (const [path, content] of Object.entries(repo)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const result = spawnSync(process.execPath, [SCRIPT, root], {
      encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('docs:check', () => {
  it('passes when every relative link points to an existing file', () => {
    const result = runCheck({
      'README.md': 'See [guide](docs/guide.md).',
      'docs/guide.md': 'Back to [home](../README.md).',
    });

    assert.equal(result.status, 0);
  });

  it('fails and lists file and link when a relative target is missing', () => {
    const result = runCheck({
      'docs/guide.md': 'Read [setup](./setup.md).',
    });

    assert.equal(result.status, 1);
    assert.match(result.output, /docs\/guide\.md -> \.\/setup\.md/);
  });

  it('checks only the file part of a link that has an anchor', () => {
    const result = runCheck({
      'docs/setup.md': '# Setup',
      'docs/guide.md': 'Jump to [install](./setup.md#install).',
    });

    assert.equal(result.status, 0);
  });

  it('reports a missing file behind an anchor', () => {
    const result = runCheck({
      'docs/guide.md': 'Jump to [install](./gone.md#install).',
    });

    assert.equal(result.status, 1);
    assert.match(result.output, /docs\/guide\.md -> \.\/gone\.md#install/);
  });

  it('ignores external links, mailto links and same-page anchors', () => {
    const result = runCheck({
      'docs/guide.md': [
        '[site](https://example.com/missing)',
        '[mail](mailto:team@example.com)',
        '[top](#top)',
      ].join('\n'),
    });

    assert.equal(result.status, 0);
  });

  it('ignores markdown examples inside code spans and fenced blocks', () => {
    const result = runCheck({
      'docs/guide.md': [
        'Write `[x](./gone.md)` to link.',
        '',
        '```md',
        '[example](./gone.md)',
        '```',
      ].join('\n'),
    });

    assert.equal(result.status, 0);
  });

  it('checks package and app readmes', () => {
    const result = runCheck({
      'packages/tool/README.md': 'See [notes](./NOTES.md).',
    });

    assert.equal(result.status, 1);
    assert.match(result.output, /packages\/tool\/README\.md -> \.\/NOTES\.md/);
  });

  it('skips decisions and todos folders', () => {
    const result = runCheck({
      'decisions/20261122-000000-docs-add-note.md': '[old](./removed.md)',
      'todos/old-spec.md': '[gone](../docs/removed.md)',
    });

    assert.equal(result.status, 0);
  });
});
