import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { changeTypes, priorities } from '@repo/factory-core/order/events';
import {
  orderIdOf,
  orderIdSchema,
  planSlugSchema,
  projectIdSchema,
  todoIdSchema,
  type OrderId,
  type ProjectId,
} from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
  type Context,
} from '../context';
import { defaultRepoDir, lineSnapshotOf } from './repo-lines';

/** The optional string a flag gives, or undefined when the flag is absent. */
const stringFlag = (args: Record<string, unknown>, name: string) =>
  args[name] === undefined ? undefined : String(args[name]);

/** Reads the spec text of `order create`: exactly one of `--file`, `--body` or stdin (`-`). */
export const readSpecText = (args: {
  file?: string;
  body?: string;
}): string => {
  const { file, body } = args;
  if (file !== undefined && body !== undefined) {
    throw new Error('give the spec as --file or --body, not both');
  }
  if (file === undefined && body === undefined) {
    throw new Error(
      'give the spec as --file <path>, --body <text>, or - for stdin',
    );
  }
  const text =
    file === '-' || (file === undefined && body === '-')
      ? readFileSync(0, 'utf8')
      : file !== undefined
        ? readFileSync(resolve(file), 'utf8')
        : (body as string);
  if (text.trim() === '') throw new Error('the spec is empty');
  return text;
};

/** `--depends-on a,b`: todo ids of the same project, or full OrderIds (containing `:`), as OrderIds. */
export const parseDependsOn = (
  project: ProjectId,
  text: string | undefined,
): OrderId[] => {
  if (text === undefined || text.trim() === '') return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      if (part.includes(':')) {
        const parsed = orderIdSchema.safeParse(part);
        if (!parsed.success) throw new Error(`"${part}" is not an OrderId`);
        return parsed.data;
      }
      const todo = todoIdSchema.safeParse(part);
      if (!todo.success) throw new Error(`"${part}" is not a todo id`);
      return orderIdOf(project, todo.data);
    });
};

/** The enum value a flag names, refused with the choices when it is not one of them. */
const choice = <T extends string>(
  name: string,
  value: string,
  options: readonly T[],
): T => {
  if ((options as readonly string[]).includes(value)) return value as T;
  throw new Error(`--${name} must be ${options.join(', ')}, not "${value}"`);
};

/** `factory order create`: a Work order from a spec, with its Line read from the repo's `.factory/`. */
const createOrder = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx: Context = createContext(flagsOf(args));
    const project = projectIdSchema.parse(String(args.project ?? ''));
    const todoId = todoIdSchema.parse(String(args['todo-id'] ?? ''));
    const title = String(args.title ?? '');
    if (title === '') throw new Error('--title must not be empty');
    const type = choice('type', String(args.type ?? ''), changeTypes.options);
    const priority = choice(
      'priority',
      stringFlag(args, 'priority') ?? 'medium',
      priorities.options,
    );
    const lineName = String(args.line ?? '');
    if (lineName === '') throw new Error('--line <name> is required');
    const repoDir = resolve(stringFlag(args, 'repo-dir') ?? defaultRepoDir());
    const line = await lineSnapshotOf(repoDir, lineName);
    const body = readSpecText({
      file: stringFlag(args, 'file'),
      body: stringFlag(args, 'body'),
    });
    const plan = stringFlag(args, 'plan');
    const baseBranch = stringFlag(args, 'base-branch');
    const response = await ctx.client.call('createOrder', {
      commandId: ctx.commandId(),
      projectId: project,
      todoId,
      title,
      type,
      body,
      line,
      priority,
      dependsOn: parseDependsOn(project, stringFlag(args, 'depends-on')),
      ...(plan === undefined ? {} : { plan: planSlugSchema.parse(plan) }),
      ...(baseBranch === undefined ? {} : { baseBranch }),
    });
    if (ctx.json) return printJson(response);
    console.log(`created ${response.orderId}`);
  });

/** `factory order pr-state <orderId> <open|merged|closed> --pr-url <url>`: sets a Work order's PR state by hand. */
const setPrState = (
  orderIdText: string,
  stateText: string,
  args: Record<string, unknown>,
) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const orderId = orderIdSchema.parse(orderIdText);
    const state = choice('state', stateText, ['open', 'merged', 'closed']);
    const prUrl = stringFlag(args, 'pr-url');
    if (prUrl === undefined) throw new Error('--pr-url <url> is required');
    const response = await ctx.client.call('recordPrState', {
      commandId: ctx.commandId(),
      orderId,
      prUrl,
      state,
    });
    if (ctx.json) return printJson(response);
    console.log(`${orderId} PR ${state}`);
  });

export const orderCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description:
      'Create a Work order from a spec, pinned to a Line in the repo',
  },
  args: {
    ...globalArgs,
    project: { type: 'string', required: true, description: 'The project id' },
    'todo-id': {
      type: 'string',
      required: true,
      description: 'The todo slug (the order id is <project>:<todo-id>)',
    },
    title: { type: 'string', required: true, description: 'The spec title' },
    type: {
      type: 'string',
      required: true,
      description: 'The change type: feat, fix, chore, …',
    },
    line: {
      type: 'string',
      required: true,
      description: 'The Line name, read from <repo>/.factory/lines/<name>.yml',
    },
    'repo-dir': {
      type: 'string',
      description:
        'The repository whose .factory/ holds the Line (default: cwd)',
    },
    priority: {
      type: 'string',
      description: 'high, medium or low (default medium)',
    },
    plan: { type: 'string', description: 'The Order Plan slug to join' },
    'depends-on': {
      type: 'string',
      description: 'Comma-separated todo ids this order waits for',
    },
    'base-branch': {
      type: 'string',
      description: 'The branch the order is based on',
    },
    file: {
      type: 'string',
      description: 'The spec from a file (- reads stdin)',
    },
    body: { type: 'string', description: 'The spec as text (- reads stdin)' },
  },
  run: ({ args }) => createOrder(args),
});

export const orderPrStateCommand = defineCommand({
  meta: {
    name: 'pr-state',
    description: 'Set a Work order PR state by hand (no webhook)',
  },
  args: {
    ...globalArgs,
    orderId: {
      type: 'positional',
      required: true,
      description: 'The order id',
    },
    state: {
      type: 'positional',
      required: true,
      description: 'open, merged or closed',
    },
    'pr-url': {
      type: 'string',
      required: true,
      description: 'The pull request URL',
    },
  },
  run: ({ args }) => setPrState(String(args.orderId), String(args.state), args),
});

/** `factory order`: create a Work order and set its PR state. */
export const orderCommand = defineCommand({
  meta: {
    name: 'order',
    description: 'Create Work orders and set their PR state',
  },
  args: { ...globalArgs },
  subCommands: {
    create: orderCreateCommand,
    'pr-state': orderPrStateCommand,
  },
});
