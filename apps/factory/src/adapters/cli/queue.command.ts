import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { type RunResult, run } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import {
  type QueueAction,
  type QueueActionResult,
  runQueueAction,
} from '../../application/procedures/queue/actions.procedure';
import {
  type QueueListResult,
  listQueue,
} from '../../application/procedures/queue/list.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printError, printJson, printLine } from './output';

interface ListFilters {
  state?: string;
  line?: string;
  plan?: string;
}

const HEADERS = ['id', 'state', 'line', 'priority', 'plan', 'active cell'];

const cell = (value: string | null): string => value ?? '-';

const reportFailure = <O>(result: RunResult<O>): number => {
  if (result.kind === 'ok') {
    return EXIT.ok;
  }
  printError(result.message);
  return result.exitCode;
};

const padRow = (cells: string[], widths: number[]): string =>
  cells
    .map((text, index) => text.padEnd(widths[index] ?? 0))
    .join('  ')
    .trimEnd();

const printTable = (rows: string[][]): void => {
  const widths = HEADERS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  printLine(padRow(HEADERS, widths));
  for (const row of rows) {
    printLine(padRow(row, widths));
  }
};

const printList = (result: QueueListResult, json: boolean): void => {
  if (json) {
    printJson(result.rows);
    return;
  }
  printTable(
    result.rows.map((row) => [
      row.orderId,
      row.state,
      row.line,
      row.priority,
      cell(row.plan),
      cell(row.activeCellId),
    ]),
  );
};

const printActions = (result: QueueActionResult, json: boolean): void => {
  if (json) {
    printJson(result.orders);
    return;
  }
  for (const order of result.orders) {
    printLine(`${order.orderId} ${order.state} ${order.priority}`);
  }
};

const runList = async (
  filters: ListFilters,
  json: boolean,
): Promise<number> => {
  const result = await run(
    listQueue,
    {
      configPath: resolve(process.cwd(), REPO_CONFIG_PATH),
      ...filters,
    },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printList(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runAction = async (
  action: QueueAction,
  orderIds: string[],
  options: { priority?: string; yes: boolean; json: boolean },
): Promise<number> => {
  const result = await run(
    runQueueAction,
    { action, orderIds, priority: options.priority, yes: options.yes },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printActions(result.value, options.json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const actionCommand = (action: QueueAction, description: string) =>
  defineCommand({
    meta: { name: action, description },
    args: {
      json: { type: 'boolean', default: false },
      yes: {
        type: 'boolean',
        default: false,
        description: 'Confirm the change (required for cancel)',
      },
      priority: {
        type: 'string',
        description: 'high|medium|low, for reprioritise',
      },
    },
    run: async ({ args }) => {
      process.exitCode = await runAction(action, args._.map(String), {
        priority: args.priority,
        yes: args.yes,
        json: args.json,
      });
    },
  });

// The parent declares the filter flags too: citty reads a bare word after an
// undeclared flag as a subcommand name, so `queue --state x` would fail.
const LIST_ARGS = {
  state: { type: 'string', description: 'Only this work order state' },
  line: { type: 'string', description: 'Only this line' },
  plan: { type: 'string', description: 'Only this plan slug' },
  json: { type: 'boolean', default: false },
} as const;

const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show the live queue' },
  args: LIST_ARGS,
  run: async ({ args }) => {
    process.exitCode = await runList(
      { state: args.state, line: args.line, plan: args.plan },
      args.json,
    );
  },
});

export const queueCommand = defineCommand({
  meta: {
    name: 'queue',
    description: 'Show the live queue and run bulk actions on work orders',
  },
  args: LIST_ARGS,
  default: 'list',
  subCommands: {
    list: listCommand,
    pause: actionCommand('pause', 'Pause work orders'),
    unpause: actionCommand('unpause', 'Unpause work orders'),
    reprioritise: actionCommand(
      'reprioritise',
      'Set the priority of work orders',
    ),
    reset: actionCommand('reset', 'Reset work orders to scratch'),
    cancel: actionCommand('cancel', 'Cancel work orders (needs --yes)'),
  },
});
