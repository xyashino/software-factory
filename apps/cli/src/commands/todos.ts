import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineCommand } from 'citty';
import {
  planSlugSchema,
  projectIdSchema,
  type OrderId,
  type PlanSlug,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import type { TodoSource } from '@repo/factory-definitions/todo';
import {
  createContext,
  flagsOf,
  globalArgs,
  messageOf,
  printJson,
  withErrors,
  type Context,
} from '../context';
import { toChainMember } from './plan';
import {
  planMigration,
  type MigrationItem,
  type MigrationPlan,
} from './migration';
import { defaultRepoDir, repoLineSnapshots } from './repo-lines';
import { repoOriginUrl } from './repo-origin';

const stringFlag = (args: Record<string, unknown>, name: string) =>
  args[name] === undefined ? undefined : String(args[name]);

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

// A deterministic commandId for one create: the same file text and target always map to the same id,
// so a repeated create is the same command to the server. Fixed length: 48 hex digits.
const commandIdOf = (
  kind: 'order' | 'plan',
  target: string,
  text: string,
): string => `migrate:${digest(`${kind}|${target}|${text}`).slice(0, 48)}`;

/** The `.md` files of the todos directory, sorted, each with its path relative to the repo root. */
export const readTodoSources = (dir: string, repoDir: string): TodoSource[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return {
        file: relative(repoDir, path) || path,
        text: readFileSync(path, 'utf8'),
      };
    });

interface Counts {
  created: number;
  wouldCreate: number;
  skipped: number;
  errors: number;
}

const countsOf = (items: readonly MigrationItem[]): Counts => ({
  created: items.filter((i) => i.outcome === 'created').length,
  wouldCreate: items.filter((i) => i.outcome === 'would-create').length,
  skipped: items.filter((i) => i.outcome === 'skipped').length,
  errors: items.filter((i) => i.outcome === 'error').length,
});

const printReport = (
  items: readonly MigrationItem[],
  counts: Counts,
  dryRun: boolean,
  removed: readonly string[],
): void => {
  for (const item of items) {
    console.log(
      `${item.outcome.padEnd(12)} ${item.file}  ${item.target}  ${item.reason}`,
    );
  }
  const parts = dryRun
    ? [`${counts.wouldCreate} would be created`]
    : [`${counts.created} created`];
  parts.push(`${counts.skipped} skipped`, `${counts.errors} error(s)`);
  console.log(parts.join(', '));
  if (removed.length > 0) console.log(`removed ${removed.length} file(s)`);
};

const execute = async (
  ctx: Context,
  projectId: ProjectId,
  plan: MigrationPlan,
  sources: ReadonlyMap<string, TodoSource>,
  lines: ReadonlyMap<string, LineSnapshot>,
): Promise<MigrationItem[]> => {
  const items = new Map(plan.items.map((item) => [item.file, { ...item }]));
  const set = (file: string, patch: Partial<MigrationItem>) => {
    const item = items.get(file);
    if (item !== undefined) items.set(file, { ...item, ...patch });
  };
  const failed = new Set<OrderId>();

  for (const unit of plan.plans) {
    const texts = unit.members.map((m) => sources.get(m.file)?.text ?? '');
    try {
      await ctx.client.call('createPlan', {
        commandId: commandIdOf(
          'plan',
          `${projectId}:${unit.slug}`,
          texts.join('\n'),
        ),
        projectId,
        slug: unit.slug,
        members: unit.members.map((member) => {
          const line = lines.get(member.line);
          if (line === undefined)
            throw new Error(`unknown line "${member.line}"`);
          return toChainMember(member, line);
        }),
      });
      for (const member of unit.members) {
        set(member.file, { outcome: 'created', onServer: true });
      }
    } catch (error) {
      for (const member of unit.members) {
        failed.add(member.orderId);
        set(member.file, {
          outcome: 'error',
          reason: messageOf(error),
          onServer: false,
        });
      }
    }
  }

  for (const unit of plan.orders) {
    const { todo } = unit;
    const text = sources.get(todo.file)?.text ?? '';
    const blockedBy = unit.dependsOn.find((dep) => failed.has(dep));
    if (blockedBy !== undefined) {
      failed.add(todo.orderId);
      set(todo.file, {
        outcome: 'error',
        reason: `depends on ${blockedBy}, which failed`,
        onServer: false,
      });
      continue;
    }
    const line = lines.get(todo.line);
    try {
      if (line === undefined) throw new Error(`unknown line "${todo.line}"`);
      await ctx.client.call('createOrder', {
        commandId: commandIdOf('order', todo.orderId, text),
        projectId,
        todoId: todo.todoId,
        title: todo.title,
        type: todo.type,
        body: todo.body,
        line,
        priority: todo.priority,
        dependsOn: unit.dependsOn,
      });
      set(todo.file, { outcome: 'created', onServer: true });
    } catch (error) {
      failed.add(todo.orderId);
      set(todo.file, {
        outcome: 'error',
        reason: messageOf(error),
        onServer: false,
      });
    }
  }

  return plan.items.map((item) => items.get(item.file) ?? item);
};

// `factory todos migrate`: imports the repo's `todos/` into the server, once. Plans come
// from `createPlan`, standalone todos from `createOrder`, in dependency order, with deterministic
// commandIds. A file the server already has is `skipped`; re-running is idempotent. Files are deleted
// only with `--remove`, and only after the server confirmed them.
const migrate = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const projectId = projectIdSchema.parse(String(args.project ?? ''));
    const repoDir = resolve(stringFlag(args, 'repo-dir') ?? defaultRepoDir());
    const dir = resolve(stringFlag(args, 'dir') ?? join(repoDir, 'todos'));
    if (!existsSync(dir)) throw new Error(`no todos directory at ${dir}`);
    const dryRun = args['dry-run'] === true;
    const all = args.all === true;
    const remove = args.remove === true;

    const lines = await repoLineSnapshots(repoDir);
    const sources = readTodoSources(dir, repoDir);
    const { projects } = await ctx.client.call('projectList', {});
    if (!projects.some((project) => project.projectId === projectId)) {
      if (args.register !== true) {
        throw new Error(
          `project ${projectId} is not registered; run factory project add ${projectId} --repo <url> first, or pass --register inside a repository with an origin`,
        );
      }
      const origin = await repoOriginUrl(repoDir);
      if (origin === undefined) {
        throw new Error(
          `project ${projectId} is not registered and ${repoDir} has no origin remote to register it from`,
        );
      }
      await ctx.client.call('projectAdd', {
        projectId,
        repoUrl: origin,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      });
      console.error(`registered ${projectId} from ${origin}`);
    }
    const { orders } = await ctx.client.call('board', {});
    const { plans } = await ctx.client.call('plans', {});
    const existingOrderIds = new Set<OrderId>(
      orders.map((order) => order.orderId as OrderId),
    );
    const existingPlanSlugs = new Set<PlanSlug>(
      plans
        .filter((plan) => plan.projectId === projectId)
        .map((plan) => planSlugSchema.parse(plan.slug)),
    );

    const plan = planMigration({
      projectId,
      sources,
      lines: new Set(lines.keys()),
      existingOrderIds,
      existingPlanSlugs,
      all,
    });
    const sourceOf = new Map(sources.map((s) => [s.file, s]));

    const items = dryRun
      ? plan.items
      : await execute(ctx, projectId, plan, sourceOf, lines);
    const removed: string[] = [];
    if (remove && !dryRun) {
      for (const item of items) {
        if (!item.onServer) continue;
        unlinkSync(join(repoDir, item.file));
        removed.push(item.file);
      }
    }
    const counts = countsOf(items);

    if (ctx.json) {
      printJson({
        dryRun,
        project: projectId,
        dir,
        items,
        removed,
        counts,
      });
    } else {
      console.log(
        `todos migrate ${dir} (project ${projectId}${dryRun ? ', dry run' : ''})`,
      );
      printReport(items, counts, dryRun, removed);
    }
    if (counts.errors > 0) process.exitCode = 1;
  });

export const todosMigrateCommand = defineCommand({
  meta: {
    name: 'migrate',
    description:
      'Import todos/ into the server once: plans and standalone orders',
  },
  args: {
    ...globalArgs,
    project: { type: 'string', required: true, description: 'The project id' },
    dir: {
      type: 'string',
      description: 'The todos directory (default: <repo-dir>/todos)',
    },
    'repo-dir': {
      type: 'string',
      description:
        'The repository whose .factory/lines hold the Lines (default: cwd)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print what would be created; make no changes',
    },
    all: {
      type: 'boolean',
      description: 'Migrate every runnable todo, not only factory: v2 ones',
    },
    remove: {
      type: 'boolean',
      description:
        'Delete each file the server has confirmed (never on a dry run)',
    },
    register: {
      type: 'boolean',
      description:
        'Register the project from the repository origin when it is not registered yet',
    },
  },
  run: ({ args }) => migrate(args),
});

/** `factory todos`: the one-time migration of a repo's `todos/` folder. */
export const todosCommand = defineCommand({
  meta: {
    name: 'todos',
    description: 'Migrate a todos/ folder into the server',
  },
  args: { ...globalArgs },
  subCommands: {
    migrate: todosMigrateCommand,
  },
});
