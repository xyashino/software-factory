import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import {
  type PlanTransitionResult,
  PLAN_TRANSITIONS,
  transitionPlan,
} from '../../application/procedures/plans/transition.procedure';
import {
  type PlanListResult,
  listPlans,
} from '../../application/procedures/plans/list.procedure';
import { type OrderPlan } from '../../application/procedures/plans/lookup';
import { showPlan } from '../../application/procedures/plans/show.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, printTable, reportFailure } from './output';
import { requiredPositional } from './validate';

type PlanAction = (typeof PLAN_TRANSITIONS)[number];

const HEADERS = ['plan', 'state', 'branch', 'title'];

const cell = (value: string | null): string => value ?? '-';

const repoConfigPath = (): string => resolve(process.cwd(), REPO_CONFIG_PATH);

const printList = (result: PlanListResult, json: boolean): void => {
  if (json) {
    printJson(result.rows);
    return;
  }
  printTable(
    HEADERS,
    result.rows.map((plan) => [plan.slug, plan.state, plan.branch, plan.title]),
  );
};

const printPlan = (plan: OrderPlan, json: boolean): void => {
  if (json) {
    printJson(plan);
    return;
  }
  printLine(
    `plan ${plan.slug} state=${plan.state} branchCommitSha=${cell(plan.branchCommitSha)} failureDetail=${cell(plan.failureDetail)}`,
  );
};

const printTransition = (result: PlanTransitionResult, json: boolean): void => {
  if (json) {
    printJson(result.plan);
    return;
  }
  printLine(`plan ${result.plan.slug} ${result.plan.state}`);
};

const runList = async (json: boolean): Promise<number> => {
  const result = await run(
    listPlans,
    { configPath: repoConfigPath() },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printList(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runShow = async (slug: string, json: boolean): Promise<number> => {
  const result = await run(
    showPlan,
    { configPath: repoConfigPath(), slug },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printPlan(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runTransition = async (
  action: PlanAction,
  slug: string,
  json: boolean,
): Promise<number> => {
  const result = await run(
    transitionPlan,
    { configPath: repoConfigPath(), slug, action },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printTransition(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const slugArg = {
  slug: {
    type: 'positional' as const,
    required: true,
    description: 'Plan slug',
  },
  json: { type: 'boolean' as const, default: false },
};

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List the order plans of the repo project',
  },
  args: { json: { type: 'boolean', default: false } },
  run: async ({ args }) => {
    process.exitCode = await runList(args.json);
  },
});

const showCommand = defineCommand({
  meta: {
    name: 'show',
    description: 'Show one order plan with its state and failure detail',
  },
  args: slugArg,
  run: async ({ args }) => {
    process.exitCode = await runShow(
      requiredPositional(args.slug, 'plan slug'),
      args.json,
    );
  },
});

const transitionCommand = (action: PlanAction, description: string) =>
  defineCommand({
    meta: { name: action, description },
    args: slugArg,
    run: async ({ args }) => {
      process.exitCode = await runTransition(
        action,
        requiredPositional(args.slug, 'plan slug'),
        args.json,
      );
    },
  });

export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'List, show, activate and retry order plans',
  },
  subCommands: {
    list: listCommand,
    show: showCommand,
    activate: transitionCommand('activate', 'Move a draft plan to branching'),
    retry: transitionCommand('retry', 'Retry a failed plan from branching'),
  },
});
