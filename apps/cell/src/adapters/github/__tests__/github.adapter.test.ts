import { describe, expect, it } from 'vitest';
import { createGithubAdapter, type GhRunner } from '../github.adapter';

/** A `gh` runner that answers each call from a queue and records the arguments. */
const scripted = (
  replies: { code?: number; stdout?: string; stderr?: string }[],
) => {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    const reply = replies.shift();
    return {
      code: reply?.code ?? 0,
      stdout: reply?.stdout ?? '',
      stderr: reply?.stderr ?? '',
    };
  };
  return { run, calls };
};

describe('github adapter', () => {
  it('finds the open PR of a branch', async () => {
    const gh = scripted([
      {
        stdout: JSON.stringify([
          { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN' },
        ]),
      },
    ]);
    const github = createGithubAdapter('/repo', gh.run);

    expect(await github.findPr('factory/task-1')).toEqual({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
      state: 'open',
    });
    expect(gh.calls[0]).toEqual([
      'pr',
      'list',
      '--head',
      'factory/task-1',
      '--json',
      'number,url,state',
    ]);
  });

  it('reports no PR when the branch has none', async () => {
    const github = createGithubAdapter(
      '/repo',
      scripted([{ stdout: '[]' }]).run,
    );
    expect(await github.findPr('factory/task-1')).toBeUndefined();
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
