import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeliverer } from '../deliver';
import { loadPrTemplates } from '../../prompts/templates';
import { PACKAGE_ROOT } from '../../paths';
import { FakeGit } from '../../testing/fake-git';
import { FakeGithub } from '../../testing/fake-github';

const TODO =
  '---\nstatus: todo\ntype: feat\n---\n\n# Todo: hello\n\n## 🎯 Objective\n\nAdd hello.\n';
const COMMIT = 'feat(hello): add script\n\n- print hello\n';
const DECISION = 'decisions/20261111-hello.md';

/** A worktree-less delivery fixture: temp commit/report/todo files and fake git and GitHub. */
const fixture = (
  options: { commit?: string; uncommitted?: string[]; added?: string[] } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-deliver-'));
  mkdirSync(join(dir, 'todos'));
  const todoPath = join(dir, 'todos', 'hello.md');
  writeFileSync(todoPath, TODO);
  const commitFile = join(dir, 'commit.txt');
  writeFileSync(commitFile, options.commit ?? COMMIT);
  const reportFile = join(dir, 'report.md');
  writeFileSync(reportFile, '- added hello');
  const git = new FakeGit();
  git.uncommitted = options.uncommitted ?? ['hello.sh'];
  git.added = options.added ?? [DECISION, 'hello.sh'];
  const github = new FakeGithub();
  const loaded = loadPrTemplates(PACKAGE_ROOT);
  if (loaded.errors.length > 0) throw new Error(JSON.stringify(loaded.errors));
  const deliverer = createDeliverer({
    git,
    github,
    baseRef: 'origin/main',
    templates: loaded.templates,
  });
  const input = {
    taskId: 'hello',
    to: 'new-pr' as const,
    worktree: join(dir, '.worktrees', 'hello'),
    branch: 'factory/hello',
    commitFile,
    reportFile,
    todoPath,
    todoRelPath: 'todos/hello.md',
    verification: [{ label: '`pnpm test`', passed: true }],
  };
  return { git, github, deliverer, input, todoPath };
};

describe('delivering a new PR', () => {
  it('commits, pushes and opens one PR with the commit title and a structured body', async () => {
    const f = fixture();

    const { prUrl } = await f.deliverer.deliver(f.input);

    expect(prUrl).toBe('https://example.test/pull/1');
    expect(f.git.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(['commitAll', 'push']),
    );
    expect(f.github.created).toHaveLength(1);
    expect(f.github.created[0]).toMatchObject({
      branch: 'factory/hello',
      base: 'main',
      title: 'feat(hello): add script',
      draft: false,
    });
    expect(f.github.created[0]?.body).toContain('- print hello');
    expect(f.github.created[0]?.body).toContain(`- Path: \`${DECISION}\``);
    expect(f.github.created[0]?.body).toContain('- added hello');
    expect(f.github.created[0]?.body).toContain('- [x] `pnpm test`');
  });

  it('checks the PR checklist only for results that passed', async () => {
    const f = fixture();
    await f.deliverer.deliver({
      ...f.input,
      verification: [
        { label: '`pnpm test`', passed: true },
        { label: 'Agent step `audit` (doctor)', passed: false },
      ],
    });
    const body = f.github.created[0]?.body ?? '';
    expect(body).toContain('- [x] `pnpm test`');
    expect(body).toContain('- [ ] Agent step `audit` (doctor)');
  });

  it('removes the todo file from the checkout and from the delivery commit', async () => {
    const f = fixture({ uncommitted: [] });
    await f.deliverer.deliver(f.input);

    expect(existsSync(f.todoPath)).toBe(false);
    const methods = f.git.calls.map((call) => call.method);
    expect(methods.indexOf('removeFile')).toBeLessThan(
      methods.indexOf('commitAll'),
    );
    expect(
      f.git.calls.find((call) => call.method === 'removeFile')?.args[0],
    ).toEqual({ worktree: f.input.worktree, path: 'todos/hello.md' });
  });

  it('removes the todo file when a PR already exists after a restart', async () => {
    const f = fixture();
    await f.deliverer.deliver(f.input);
    writeFileSync(f.todoPath, TODO);

    await f.deliverer.deliver(f.input);

    expect(existsSync(f.todoPath)).toBe(false);
    expect(f.github.created).toHaveLength(1);
  });

  it('delivers when the todo file is already gone', async () => {
    const f = fixture();
    rmSync(f.todoPath);

    const { prUrl } = await f.deliverer.deliver(f.input);

    expect(prUrl).toBe('https://example.test/pull/1');
    expect(f.github.created).toHaveLength(1);
  });

  it('reuses the existing PR after a restart instead of opening a second one', async () => {
    const f = fixture();
    const first = await f.deliverer.deliver(f.input);
    const second = await f.deliverer.deliver(f.input);

    expect(second.prUrl).toBe(first.prUrl);
    expect(f.github.created).toHaveLength(1);
  });

  it('refuses a commit subject that is not conventional, before pushing', async () => {
    const f = fixture({ commit: 'add hello' });
    await expect(f.deliverer.deliver(f.input)).rejects.toThrow('type(scope)');
    expect(f.git.calls.map((call) => call.method)).not.toContain('push');
    expect(f.github.created).toHaveLength(0);
  });

  it('refuses a delivery without exactly one new decision entry', async () => {
    const f = fixture({ added: ['hello.sh'] });
    await expect(f.deliverer.deliver(f.input)).rejects.toThrow('decisions/');
    expect(f.github.created).toHaveLength(0);
  });
});

describe('publishing a blocked task', () => {
  it('commits the work as wip and opens a draft [BLOCKED] PR', async () => {
    const f = fixture();

    const { prUrl } = await f.deliverer.publishBlocked({
      taskId: 'hello',
      worktree: f.input.worktree,
      branch: 'factory/hello',
      reason: 'retries_exhausted',
      detail: 'gate failed 4 times',
    });

    expect(prUrl).toBe('https://example.test/pull/1');
    expect(
      f.git.calls.find((call) => call.method === 'commitAll')?.args[0],
    ).toEqual({
      worktree: f.input.worktree,
      message: 'wip: [BLOCKED] hello retries_exhausted',
    });
    expect(f.github.created[0]).toMatchObject({
      title: '[BLOCKED] hello retries_exhausted',
      draft: true,
    });
    expect(f.github.created[0]?.body).toContain('gate failed 4 times');
  });

  it('leaves the todo file in place on a blocked delivery', async () => {
    const f = fixture();
    await f.deliverer.publishBlocked({
      taskId: 'hello',
      worktree: f.input.worktree,
      branch: 'factory/hello',
      reason: 'retries_exhausted',
      detail: 'gate failed 4 times',
    });
    expect(existsSync(f.todoPath)).toBe(true);
    expect(f.git.calls.map((call) => call.method)).not.toContain('removeFile');
  });
});
