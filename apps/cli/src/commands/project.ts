import { defineCommand } from 'citty';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/** The `--dep-policy` values (PROTOCOL §3.1): when a dependency counts as done. */
const DEP_POLICIES = ['delivered', 'merged'] as const;
type DepPolicy = (typeof DEP_POLICIES)[number];

/** A positive whole number, as `--max-running` takes it. */
const MAX_RUNNING = /^[1-9]\d*$/;

const usageError = (message: string): Error => new Error(message);

/** `--dep-policy` must be one of the two policies; anything else is a usage error, sent to nothing. */
export const parseDepPolicy = (text: string): DepPolicy => {
  const match = DEP_POLICIES.find((policy) => policy === text);
  if (!match) {
    throw usageError(`--dep-policy must be delivered or merged, not "${text}"`);
  }
  return match;
};

/** `--max-running` is a positive whole number: a usage error on zero, a fraction or a word. */
export const parseMaxRunning = (text: string): number => {
  if (!MAX_RUNNING.test(text)) {
    throw usageError(
      `--max-running must be a whole number of 1 or more, not "${text}"`,
    );
  }
  return Number(text);
};

/** The optional string a flag gives, or undefined when the flag is absent. */
const stringFlag = (args: Record<string, unknown>, name: string) =>
  args[name] === undefined ? undefined : String(args[name]);

/** The settings the flags name, parsed and checked before any call (PROTOCOL §3.1). */
const settingsOf = (args: Record<string, unknown>) => {
  const baseBranch = stringFlag(args, 'base-branch');
  const depPolicy = stringFlag(args, 'dep-policy');
  const maxRunning = stringFlag(args, 'max-running');
  return {
    ...(baseBranch !== undefined ? { baseBranch } : {}),
    ...(depPolicy !== undefined
      ? { depPolicy: parseDepPolicy(depPolicy) }
      : {}),
    ...(maxRunning !== undefined
      ? { maxRunning: parseMaxRunning(maxRunning) }
      : {}),
  };
};

/** `factory project ls`: the registry, one row per project (PROTOCOL §3.1). */
const listProjects = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const { projects } = await ctx.client.call('projectList', {});
    if (ctx.json) return printJson({ projects });
    if (projects.length === 0) return console.log('no projects');
    console.log(
      ctx.paint.dim(
        `${'ID'.padEnd(24)} ${'REPO'.padEnd(40)} ${'BASE'.padEnd(12)} ${'MAX'.padEnd(5)} DEP POLICY`,
      ),
    );
    for (const project of projects) {
      console.log(
        `${project.projectId.padEnd(24)} ${project.repoUrl.padEnd(40)} ${project.baseBranch.padEnd(12)} ${String(project.maxRunning).padEnd(5)} ${project.depPolicy}`,
      );
    }
  });

export const projectLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List the projects' },
  args: { ...globalArgs },
  run: ({ args }) => listProjects(args),
});

/**
 * `factory project add <id> --repo <url> [...]`. A Cell serves the project only if its config lists it,
 * so the hint names that on stderr, where a script does not read it.
 */
export const projectAddCommand = defineCommand({
  meta: { name: 'add', description: 'Register a project' },
  args: {
    ...globalArgs,
    id: { type: 'positional', required: true, description: 'The project id' },
    repo: { type: 'string', description: 'The repository url (required)' },
    'base-branch': {
      type: 'string',
      description: 'The base branch (default main)',
    },
    'dep-policy': {
      type: 'string',
      description: 'When a dependency counts as done: delivered | merged',
    },
    'max-running': {
      type: 'string',
      description: 'Work orders run at once (default 2)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const repo = stringFlag(args, 'repo');
      if (repo === undefined || repo === '') {
        throw usageError('project add needs --repo <url>');
      }
      const settings = settingsOf(args);
      const { project } = await ctx.client.call('projectAdd', {
        projectId: String(args.id) as ProjectId,
        repoUrl: repo,
        ...settings,
      } as never);
      if (ctx.json) return printJson({ project });
      console.log(`added ${project.projectId}`);
      console.error(
        `a Cell serves ${project.projectId} only if its config lists it (projects in config.toml)`,
      );
    }),
});

/** `factory project set <id> [--base-branch] [--dep-policy] [--max-running]`: at least one flag. */
export const projectSetCommand = defineCommand({
  meta: { name: 'set', description: 'Change a project' },
  args: {
    ...globalArgs,
    id: { type: 'positional', required: true, description: 'The project id' },
    'base-branch': { type: 'string', description: 'The base branch' },
    'dep-policy': {
      type: 'string',
      description: 'When a dependency counts as done: delivered | merged',
    },
    'max-running': { type: 'string', description: 'Work orders run at once' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const settings = settingsOf(args);
      if (Object.keys(settings).length === 0) {
        throw usageError(
          'project set needs at least one of --base-branch, --dep-policy, --max-running',
        );
      }
      const { project } = await ctx.client.call('projectSet', {
        projectId: String(args.id) as ProjectId,
        ...settings,
      });
      if (ctx.json) return printJson({ project });
      console.log(`updated ${project.projectId}`);
    }),
});

/** `factory project rm <id>`: removes a project with no history (PROTOCOL §3.1). */
export const projectRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Remove a project with no history' },
  args: {
    ...globalArgs,
    id: { type: 'positional', required: true, description: 'The project id' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('projectRemove', {
        projectId: String(args.id) as ProjectId,
      });
      if (ctx.json) return printJson(result);
      console.log(`removed ${result.projectId}`);
    }),
});

/** `factory project`: the list by default, `add`, `set` and `rm`. */
export const projectCommand = defineCommand({
  meta: {
    name: 'project',
    description: 'List, register, change or remove projects',
  },
  args: { ...globalArgs },
  subCommands: {
    ls: projectLsCommand,
    add: projectAddCommand,
    set: projectSetCommand,
    rm: projectRmCommand,
  },
  run: ({ args }) => {
    // citty also runs the parent's `run` after a subcommand; only a bare `factory project` lists here.
    if (args._.length > 0) return;
    return listProjects(args);
  },
});
