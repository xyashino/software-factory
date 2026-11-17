import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import {
  orderIdOf,
  planSlugSchema,
  projectIdSchema,
  type PlanSlug,
  type ProjectId,
  type TodoId,
} from '@repo/factory-core/ids';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import { parseTodo, type Todo } from '@repo/factory-definitions/todo';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { renderPlanList, renderPlanStatus } from '../render/plan';
import { defaultRepoDir, repoLineSnapshots } from './repo-lines';

type PlanRow = RouteResponse<'plans'>['plans'][number];

const usageError = (message: string): Error => new Error(message);

const stringFlag = (args: Record<string, unknown>, name: string) =>
  args[name] === undefined ? undefined : String(args[name]);

/**
 * The plan a slug names. A slug is unique only within a project: `--project` picks the
 * project, and without it an ambiguous slug is a usage error that names the projects to choose from.
 */
export const resolvePlan = (
  plans: readonly PlanRow[],
  slug: string,
  project?: string,
): PlanRow => {
  const matches = plans.filter(
    (plan) =>
      plan.slug === slug &&
      (project === undefined || plan.projectId === project),
  );
  const [match, ...others] = matches;
  if (!match) {
    throw new Error(
      project === undefined
        ? `no plan "${slug}"`
        : `no plan "${slug}" in project ${project}`,
    );
  }
  if (others.length > 0) {
    const projects = matches.map((plan) => plan.projectId).join(', ');
    throw usageError(
      `plan "${slug}" is in more than one project (${projects}); pass --project <id>`,
    );
  }
  return match;
};

// `factory plan ls`: the plans, one row each. Read-only; `--json` prints `{plans}`.
const listPlans = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const { plans } = await ctx.client.call('plans', {});
    if (ctx.json) return printJson({ plans });
    console.log(renderPlanList(plans, ctx.paint));
  });

const planStatus = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const { plans } = await ctx.client.call('plans', {});
    const plan = resolvePlan(
      plans,
      String(args.slug),
      stringFlag(args, 'project'),
    );
    const detail = await ctx.client.call('planDetail', {
      planId: plan.planId,
    });
    if (ctx.json) return printJson(detail);
    console.log(renderPlanStatus(detail, ctx.paint));
  });

export const planLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List the Order Plans' },
  args: { ...globalArgs },
  run: ({ args }) => listPlans(args),
});

export const planStatusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'The chain of one plan, with its plan PR and Andon',
  },
  args: {
    ...globalArgs,
    slug: { type: 'positional', required: true, description: 'The plan slug' },
    project: {
      type: 'string',
      description:
        'The project id (required when the slug is in more than one)',
    },
  },
  run: ({ args }) => planStatus(args),
});

/**
 * Reads each `--members` file as a todo, in the order given, and checks it can join a chain: a
 * runnable `todo`, a Line the repo's `.factory/` holds, and at most the member before it as a
 * dependency (the server builds the chain from the order).
 */
export const chainMembers = async (
  project: ProjectId,
  slug: PlanSlug,
  files: readonly string[],
  repoDir: string,
) => {
  const lines = await repoLineSnapshots(repoDir);
  const todos: Todo[] = [];
  for (const file of files) {
    const parsed = parseTodo(
      project,
      file,
      readFileSync(resolve(file), 'utf8'),
    );
    if (!parsed.ok) {
      throw new Error(
        parsed.error
          .map((e) => `${e.file}: ${e.field}: ${e.message}`)
          .join('; '),
      );
    }
    todos.push(parsed.value.todo);
  }
  return todos.map((todo, index) => {
    if (todo.plan !== undefined && todo.plan !== slug) {
      throw new Error(`${todo.file} names plan ${todo.plan}, not ${slug}`);
    }
    const before = index === 0 ? undefined : todos[index - 1];
    const extra = todo.dependsOn.filter((dep) => dep !== before?.orderId);
    if (extra.length > 0) {
      throw new Error(
        `${todo.file} depends on ${extra[0]}; a plan member may depend only on the member before it`,
      );
    }
    const line = lines.get(todo.line);
    if (line === undefined) {
      throw new Error(`${todo.file}: unknown line "${todo.line}"`);
    }
    return toChainMember(todo, line);
  });
};

/**
 * A runnable todo as one member of a chain (`createPlan`). It must be a `todo`: a done or cancelled
 * member is not part of any chain.
 */
export const toChainMember = (todo: Todo, line: LineSnapshot) => {
  if (todo.status !== 'todo') {
    throw new Error(
      `${todo.file} is ${todo.status}; a plan takes todo members only`,
    );
  }
  return {
    todoId: todo.todoId,
    title: todo.title,
    type: todo.type,
    body: todo.body,
    line,
    priority: todo.priority,
  };
};

/**
 * Refuses a plan whose member order already exists. The server writes the plan first and then each
 * member, so a member it refuses would leave a plan with no members behind; checking here keeps the
 * refusal before any write.
 */
export const refuseTakenMembers = async (
  client: FactoryClient,
  project: ProjectId,
  members: readonly { todoId: TodoId }[],
): Promise<void> => {
  const { orders } = await client.call('board', {});
  const taken = new Set<string>(orders.map((order) => order.orderId));
  const clash = members.find((member) =>
    taken.has(orderIdOf(project, member.todoId)),
  );
  if (clash !== undefined) {
    throw new Error(
      `${orderIdOf(project, clash.todoId)} already exists; a plan needs new members (nothing was written)`,
    );
  }
};

const createPlan = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const project = projectIdSchema.parse(String(args.project ?? ''));
    const slug = planSlugSchema.parse(String(args.slug ?? ''));
    // citty gives the first file as `--members` and any further ones as positionals.
    const files = [
      ...(args.members === undefined ? [] : [String(args.members)]),
      ...((args._ as unknown[] | undefined) ?? []).map(String),
    ];
    if (files.length === 0) {
      throw new Error('--members <files…> needs at least one todo file');
    }
    const repoDir = resolve(stringFlag(args, 'repo-dir') ?? defaultRepoDir());
    const members = await chainMembers(project, slug, files, repoDir);
    await refuseTakenMembers(ctx.client, project, members);
    const baseBranch = stringFlag(args, 'base-branch');
    const response = await ctx.client.call('createPlan', {
      commandId: ctx.commandId(),
      projectId: project,
      slug,
      ...(baseBranch === undefined ? {} : { baseBranch }),
      members,
    });
    if (ctx.json) return printJson(response);
    console.log(
      `created plan ${slug} (${response.orderIds.length} members): ${response.orderIds.join(' -> ')}`,
    );
  });

export const planCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description:
      'Create an Order Plan: a chain of todo files, in the order given',
  },
  args: {
    ...globalArgs,
    project: { type: 'string', required: true, description: 'The project id' },
    slug: { type: 'string', required: true, description: 'The plan slug' },
    'repo-dir': {
      type: 'string',
      description:
        'The repository whose .factory/ holds the Lines (default: cwd)',
    },
    'base-branch': {
      type: 'string',
      description: 'The branch the plan is based on',
    },
    members: {
      type: 'string',
      description: 'The todo files of the chain, first to last',
    },
  },
  run: ({ args }) => createPlan(args),
});

/** `factory plan`: the list by default, and `status`. */
export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'List Order Plans and show the chain of one',
  },
  args: { ...globalArgs },
  subCommands: {
    ls: planLsCommand,
    status: planStatusCommand,
    create: planCreateCommand,
  },
  run: ({ args }) => {
    // citty also runs the parent's `run` after a subcommand; only a bare `factory plan` lists here.
    if (args._.length > 0) return;
    return listPlans(args);
  },
});
