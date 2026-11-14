import { describe, expect, it } from 'vitest';
import { createGithubAdapter, type GhRunner } from '../github.adapter';

/** A `gh` runner that answers each call from a queue and records the arguments. */
const scripted = (
  replies: { code?: number; stdout?: string; stderr?: string }[],
) => {
  const calls: string[][] = [];
  const inputs: string[] = [];
  const run: GhRunner = async (args, _cwd, input) => {
    calls.push(args);
    if (input !== undefined) inputs.push(input);
    const reply = replies.shift();
    return {
      code: reply?.code ?? 0,
      stdout: reply?.stdout ?? '',
      stderr: reply?.stderr ?? '',
    };
  };
  return { run, calls, inputs };
};

describe('github adapter', () => {
  it('finds the open PR of a head, in any state, with its draft flag', async () => {
    const gh = scripted([
      {
        stdout: JSON.stringify([
          {
            url: 'https://github.com/o/r/pull/12',
            state: 'OPEN',
            isDraft: true,
          },
        ]),
      },
    ]);
    const github = createGithubAdapter('/repo', gh.run);

    expect(await github.findPr('feat/task-1')).toEqual({
      url: 'https://github.com/o/r/pull/12',
      state: 'open',
      draft: true,
    });
    expect(gh.calls[0]).toEqual([
      'pr',
      'list',
      '--head',
      'feat/task-1',
      '--state',
      'all',
      '--json',
      'url,state,isDraft',
    ]);
  });

  it('scopes the lookup to a base branch when one is given', async () => {
    const gh = scripted([{ stdout: '[]' }]);
    await createGithubAdapter('/repo', gh.run).findPr('feat/x', 'main');
    expect(gh.calls[0]).toEqual([
      'pr',
      'list',
      '--head',
      'feat/x',
      '--base',
      'main',
      '--state',
      'all',
      '--json',
      'url,state,isDraft',
    ]);
  });

  it('maps merged and closed PRs, and prefers an open one among several', async () => {
    const gh = scripted([
      {
        stdout: JSON.stringify([
          {
            url: 'https://github.com/o/r/pull/1',
            state: 'CLOSED',
            isDraft: false,
          },
          {
            url: 'https://github.com/o/r/pull/2',
            state: 'MERGED',
            isDraft: false,
          },
        ]),
      },
      {
        stdout: JSON.stringify([
          {
            url: 'https://github.com/o/r/pull/3',
            state: 'MERGED',
            isDraft: false,
          },
          {
            url: 'https://github.com/o/r/pull/4',
            state: 'OPEN',
            isDraft: false,
          },
        ]),
      },
    ]);
    const github = createGithubAdapter('/repo', gh.run);

    expect(await github.findPr('feat/x')).toEqual({
      url: 'https://github.com/o/r/pull/1',
      state: 'closed',
      draft: false,
    });
    expect(await github.findPr('feat/x')).toEqual({
      url: 'https://github.com/o/r/pull/4',
      state: 'open',
      draft: false,
    });
  });

  it('reports no PR when the head has none', async () => {
    const github = createGithubAdapter(
      '/repo',
      scripted([{ stdout: '[]' }]).run,
    );
    expect(await github.findPr('factory/task-1')).toBeUndefined();
  });

  it('marks a draft PR ready with gh pr ready', async () => {
    const gh = scripted([{ stdout: '{"isDraft":true}' }, { stdout: '' }]);
    await createGithubAdapter('/repo', gh.run).markReady(
      'https://github.com/o/r/pull/5',
    );
    expect(gh.calls).toEqual([
      ['pr', 'view', 'https://github.com/o/r/pull/5', '--json', 'isDraft'],
      ['pr', 'ready', 'https://github.com/o/r/pull/5'],
    ]);
  });

  it('leaves a PR that is already ready alone: one view, no ready call', async () => {
    const gh = scripted([{ stdout: '{"isDraft":false}' }]);
    await createGithubAdapter('/repo', gh.run).markReady(
      'https://github.com/o/r/pull/5',
    );
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toEqual([
      'pr',
      'view',
      'https://github.com/o/r/pull/5',
      '--json',
      'isDraft',
    ]);
  });

  it('writes the body through stdin, never on the command line', async () => {
    const gh = scripted([{ stdout: '' }]);
    const body = 'line one\n--body `rm -rf` $HOME';
    await createGithubAdapter('/repo', gh.run).updateBody(
      'https://github.com/o/r/pull/5',
      body,
    );
    expect(gh.calls[0]).toEqual([
      'pr',
      'edit',
      'https://github.com/o/r/pull/5',
      '--body-file',
      '-',
    ]);
    expect(gh.calls[0]?.join(' ')).not.toContain('rm -rf');
    expect(gh.inputs).toEqual([body]);
  });

  it('creates a draft PR and returns its url', async () => {
    const gh = scripted([{ stdout: 'https://github.com/o/r/pull/13\n' }]);
    const github = createGithubAdapter('/repo', gh.run);

    const created = await github.createPr({
      branch: 'factory/task-1',
      base: 'main',
      title: '[BLOCKED] task-1 stuck',
      body: 'why',
      draft: true,
    });

    expect(created).toEqual({ url: 'https://github.com/o/r/pull/13' });
    expect(gh.calls[0]).toEqual([
      'pr',
      'create',
      '--head',
      'factory/task-1',
      '--base',
      'main',
      '--title',
      '[BLOCKED] task-1 stuck',
      '--body',
      'why',
      '--draft',
    ]);
  });

  it('fails loudly when gh refuses to create a PR', async () => {
    const github = createGithubAdapter(
      '/repo',
      scripted([{ code: 1, stderr: 'no commits between main and task' }]).run,
    );
    await expect(
      github.createPr({
        branch: 'factory/task-1',
        base: 'main',
        title: 't',
        body: 'b',
        draft: false,
      }),
    ).rejects.toThrow('no commits between main and task');
  });
});
