import { describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { RouteName } from '@repo/factory-core/contracts/routes';
import { projectIdSchema } from '@repo/factory-core/ids';
import { repoProjectId } from '@repo/factory-core/repo-project';
import type { GitResult, RunGit } from '../ports';
import { ensureRepoProject, originUrlOf } from '../repo-project';

const ORIGIN = 'https://example.test/app.git';

/** A git runner answering `remote get-url origin` with the given url (or failing when undefined). */
const gitWithOrigin = (url: string | undefined): RunGit =>
  (async (): Promise<GitResult> =>
    url === undefined
      ? { code: 2, stdout: '', stderr: 'error: No such remote' }
      : { code: 0, stdout: `${url}\n`, stderr: '' }) as RunGit;

/** A client that records each call and answers the ensure route with the given `created` flag. */
const fakeClient = (created: boolean) => {
  const calls: { route: RouteName; request: unknown }[] = [];
  const client = {
    call: (route: RouteName, request: unknown) => {
      calls.push({ route, request });
      return Promise.resolve({
        project: {
          projectId: 'app',
          repoUrl: ORIGIN,
          baseBranch: 'main',
          maxRunning: 2,
          depPolicy: 'delivered',
        },
        created,
      });
    },
  } as unknown as FactoryClient;
  return { client, calls };
};

describe('repoProjectId', () => {
  it('normalizes the directory name to a project id', () => {
    expect(repoProjectId('Software_Factory App', [])).toBe(
      'software-factory-app',
    );
  });

  it('prefers the first configured project over the directory name', () => {
    expect(repoProjectId('whatever', [projectIdSchema.parse('alpha')])).toBe(
      'alpha',
    );
  });

  it('refuses a directory name that normalizes to nothing', () => {
    expect(() => repoProjectId('___', [])).toThrow(/no valid project id/);
  });
});

describe('originUrlOf', () => {
  it('reads the origin url of the repository', async () => {
    await expect(originUrlOf(gitWithOrigin(ORIGIN), '/r')).resolves.toBe(
      ORIGIN,
    );
  });

  it('refuses a repository with no origin, naming it', async () => {
    await expect(originUrlOf(gitWithOrigin(undefined), '/r')).rejects.toThrow(
      /has no origin remote/,
    );
  });
});

describe('ensureRepoProject', () => {
  it('ensures the project from origin and serves it', async () => {
    const { client, calls } = fakeClient(true);
    const logs: string[] = [];

    const repo = await ensureRepoProject({
      client,
      runGit: gitWithOrigin(ORIGIN),
      repoRoot: '/work/app',
      configured: [],
      log: (line) => logs.push(line),
    });

    expect(calls).toEqual([
      {
        route: 'cellProjectEnsure',
        request: { projectId: 'app', repoUrl: ORIGIN },
      },
    ]);
    expect(repo).toEqual({ projectId: 'app', projects: ['app'] });
    expect(logs).toEqual([
      `factory-cell: registered project app from ${ORIGIN}`,
    ]);
  });

  it('keeps the configured projects and lists the repository project once', async () => {
    const { client } = fakeClient(false);
    const logs: string[] = [];

    const repo = await ensureRepoProject({
      client,
      runGit: gitWithOrigin(ORIGIN),
      repoRoot: '/work/app',
      configured: [projectIdSchema.parse('app'), projectIdSchema.parse('lib')],
      log: (line) => logs.push(line),
    });

    expect(repo.projects).toEqual(['app', 'lib']);
    expect(logs).toEqual(['factory-cell: project app is already registered']);
  });

  it('refuses to start in a repository with no origin, before any call', async () => {
    const { client, calls } = fakeClient(true);

    await expect(
      ensureRepoProject({
        client,
        runGit: gitWithOrigin(undefined),
        repoRoot: '/work/app',
        configured: [],
        log: () => undefined,
      }),
    ).rejects.toThrow(/has no origin remote/);
    expect(calls).toEqual([]);
  });
});
