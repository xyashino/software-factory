import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createGithubAdapter } from '../adapters/github/github.adapter';
import { createGitAdapter } from '../adapters/git/git.adapter';
import { createHerdrAdapter } from '../adapters/herdr/herdr.adapter';
import { systemClock } from '../adapters/clock/system-clock';
import { SqliteStore } from '../adapters/store/sqlite-store';
import { createProcessAdapter } from '../adapters/system/process.adapter';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { loadDefinitions } from '../definitions/load';
import type { Definitions } from '../definitions/types';
import { PACKAGE_ROOT, storePath } from '../paths';
import { createDeliverer } from './deliver';
import type { SupervisorPorts } from './ports';
import { FileWorkspaceRegistry } from './workspace-registry';

/**
 * The main checkout that owns `.factory`, `.evidences` and `.worktrees`. Inside a
 * worktree this resolves to the main checkout through git's common directory.
 */
export const resolveRoot = (
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  if (env.FACTORY_ROOT) return env.FACTORY_ROOT;
  const common = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd,
      encoding: 'utf8',
    },
  ).trim();
  return join(common, '..');
};

export const loadShippedDefinitions = (): Definitions => {
  const loaded = loadDefinitions(PACKAGE_ROOT);
  if (!loaded.ok) {
    const first = loaded.error.map(
      (error) => `${error.file} ${error.field}: ${error.message}`,
    );
    throw new Error(`definitions are invalid:\n${first.join('\n')}`);
  }
  return loaded.value;
};

/** Real adapters for every supervisor port, rooted at the main checkout. */
export const openSupervisorPorts = (
  root: string,
): {
  ports: SupervisorPorts;
  close: () => void;
} => {
  const store = new SqliteStore({ path: storePath(root), clock: systemClock });
  const baseRef = 'origin/main';
  const git = createGitAdapter(root);
  const github = createGithubAdapter(root);
  const definitions = loadShippedDefinitions();
  const ports: SupervisorPorts = {
    root,
    definitions,
    store,
    herdr: createHerdrAdapter(),
    git,
    system: createSystemAdapter(),
    process: createProcessAdapter(),
    clock: systemClock,
    deliverer: createDeliverer({
      git,
      github,
      baseRef,
      templates: definitions.prTemplates,
    }),
    github,
    workspaces: new FileWorkspaceRegistry(
      join(root, '.factory', 'workspaces.json'),
    ),
    pathEnv: Bun.env.PATH ?? '',
    baseRef,
  };
  return { ports, close: () => store.close() };
};
