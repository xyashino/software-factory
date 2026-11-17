import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { defineCommand } from 'citty';
import {
  parseOrderId,
  planSlugSchema,
  projectIdSchema,
  type BlobRef,
  type OrderId,
  type PlanSlug,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import { repoProjectId } from '@repo/factory-core/repo-project';
import type { ChangeType, TodoSource } from '@repo/factory-definitions/todo';
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
import { renderTodoFile, todoStatusOf } from './todo-render';
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

// The project a repo's todos belong to: `--project`, else the project its Cell runs as (the repo's
// directory name, as the Cell derives it).
const projectOf = (repoDir: string, flag: string | undefined): ProjectId =>
  flag === undefined
    ? repoProjectId(basename(repoDir), [])
    : projectIdSchema.parse(flag);

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

interface ImportOptions {
  repoDir: string;
  dir: string;
  projectId: ProjectId;
  /** false: a dry run, which changes nothing */
  apply: boolean;
  /** migrate every runnable todo, not only `factory: v2` ones */
  all: boolean;
  remove: boolean;
  register: boolean;
}

// Imports the todos directory into the server. Plans come from `createPlan`, standalone todos from
// `createOrder`, in dependency order, with deterministic commandIds. A file the server already has is
// `skipped`; re-running is idempotent. Files are deleted only with `remove`, and only after the server
// confirmed them.
const importTodos = async (
  ctx: Context,
  options: ImportOptions,
): Promise<void> => {
  const { repoDir, dir, projectId, all, remove } = options;
  const dryRun = !options.apply;
  if (!existsSync(dir)) throw new Error(`no todos directory at ${dir}`);

  const lines = await repoLineSnapshots(repoDir);
  const sources = readTodoSources(dir, repoDir);
  const { projects } = await ctx.client.call('projectList', {});
  if (!projects.some((project) => project.projectId === projectId)) {
    if (!options.register) {
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
      `todos import ${dir} (project ${projectId}${dryRun ? ', dry run' : ''})`,
    );
    printReport(items, counts, dryRun, removed);
  }
  if (counts.errors > 0) process.exitCode = 1;
};

interface ExportItem {
  file: string;
  outcome: 'written' | 'skipped' | 'error';
  reason: string;
}

// The spec a Work order has now: the latest `order_created` or `spec_updated`.
const latestSpec = async (
  ctx: Context,
  orderId: OrderId,
): Promise<{ type: ChangeType; bodyBlob: BlobRef }> => {
  const { events } = await ctx.client.call('orderDetail', { orderId });
  let spec: { type: ChangeType; bodyBlob: BlobRef } | undefined;
  for (const { event } of events) {
    if (event.type === 'order_created' || event.type === 'spec_updated') {
      spec = { type: event.spec.type, bodyBlob: event.spec.bodyBlob };
    }
  }
  if (spec === undefined) throw new Error(`${orderId} has no spec event`);
  return spec;
};

const textOf = async (ctx: Context, ref: BlobRef): Promise<string> => {
  const { base64 } = await ctx.client.call('blobGet', { ref });
  return Buffer.from(base64, 'base64').toString('utf8');
};

// Writes `todos/<todoId>.md` for each of the project's Work orders that has no file yet. A file that
// exists is never overwritten; every order that is not written is reported with its reason.
const exportTodos = async (
  ctx: Context,
  repoDir: string,
  projectId: ProjectId,
): Promise<ExportItem[]> => {
  mkdirSync(join(repoDir, 'todos'), { recursive: true });
  const { orders } = await ctx.client.call('board', {});
  const mine = orders
    .filter((order) => order.projectId === projectId)
    .sort((a, b) => a.todoId.localeCompare(b.todoId));
  const items: ExportItem[] = [];
  for (const order of mine) {
    const file = `todos/${order.todoId}.md`;
    if (existsSync(join(repoDir, file))) {
      items.push({ file, outcome: 'skipped', reason: 'file exists' });
      continue;
    }
    try {
      const spec = await latestSpec(ctx, order.orderId);
      const dependsOn = order.dependsOn.flatMap((dep) => {
        const id = parseOrderId(dep);
        return id === undefined ? [] : [id.todoId];
      });
      writeFileSync(
        join(repoDir, file),
        renderTodoFile({
          todoId: order.todoId,
          status: todoStatusOf(order.status),
          priority: order.priority,
          type: spec.type,
          line: order.line,
          dependsOn,
          plan: order.plan,
          body: await textOf(ctx, spec.bodyBlob),
        }),
        { flag: 'wx' },
      );
      items.push({ file, outcome: 'written', reason: '' });
    } catch (error) {
      items.push({ file, outcome: 'error', reason: messageOf(error) });
    }
  }
  return items;
};

const printExport = (
  projectId: ProjectId,
  items: readonly ExportItem[],
  json: boolean,
): void => {
  const counts = {
    written: items.filter((i) => i.outcome === 'written').length,
    skipped: items.filter((i) => i.outcome === 'skipped').length,
    errors: items.filter((i) => i.outcome === 'error').length,
  };
  if (json) {
    printJson({ project: projectId, items, counts });
    return;
  }
  for (const item of items) {
    console.log(`${item.outcome.padEnd(8)} ${item.file}  ${item.reason}`);
  }
  console.log(
    `${counts.written} written, ${counts.skipped} skipped, ${counts.errors} error(s)`,
  );
};

const importArgs = {
  ...globalArgs,
  project: {
    type: 'string',
    description:
      'The project id (default: the repository directory name, as the Cell names it)',
  },
  apply: {
    type: 'boolean',
    description: 'Create the orders; without it, print what would be created',
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
} as const;

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description:
      'Import todos/ into the server: plans and standalone orders (dry run unless --apply)',
  },
  args: importArgs,
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const repoDir = defaultRepoDir();
      await importTodos(ctx, {
        repoDir,
        dir: join(repoDir, 'todos'),
        projectId: projectOf(repoDir, stringFlag(args, 'project')),
        apply: args.apply === true,
        all: false,
        remove: args.remove === true,
        register: args.register === true,
      });
    }),
});

const exportCommand = defineCommand({
  meta: {
    name: 'export',
    description:
      'Write each server order that has no todos/ file back to todos/, and list the ones skipped',
  },
  args: {
    ...globalArgs,
    project: {
      type: 'string',
      description:
        'The project id (default: the repository directory name, as the Cell names it)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const repoDir = defaultRepoDir();
      const projectId = projectOf(repoDir, stringFlag(args, 'project'));
      const items = await exportTodos(ctx, repoDir, projectId);
      printExport(projectId, items, ctx.json);
      if (items.some((item) => item.outcome === 'error')) {
        process.exitCode = 1;
      }
    }),
});

// The old `factory todos migrate`, kept one release: the same flags, applying unless `--dry-run`.
const migrate = (args: Record<string, unknown>) =>
  withErrors(async () => {
    console.error(
      'factory todos migrate is deprecated: use factory todos import',
    );
    const ctx = createContext(flagsOf(args));
    const repoDir = resolve(stringFlag(args, 'repo-dir') ?? defaultRepoDir());
    await importTodos(ctx, {
      repoDir,
      dir: resolve(stringFlag(args, 'dir') ?? join(repoDir, 'todos')),
      projectId: projectOf(repoDir, stringFlag(args, 'project')),
      apply: args['dry-run'] !== true,
      all: args.all === true,
      remove: args.remove === true,
      register: args.register === true,
    });
  });

const todosMigrateCommand = defineCommand({
  meta: {
    name: 'migrate',
    description: 'Deprecated: use factory todos import',
    hidden: true,
  },
  args: {
    ...globalArgs,
    project: {
      type: 'string',
      description: 'The project id (default: the repository directory name)',
    },
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

/** `factory todos`: the todos/ folder of a repository, imported into the server and exported back. */
export const todosCommand = defineCommand({
  meta: {
    name: 'todos',
    description: 'Import the todos/ folder into the server and export it back',
  },
  args: { ...globalArgs },
  subCommands: {
    import: importCommand,
    export: exportCommand,
    migrate: todosMigrateCommand,
  },
});
