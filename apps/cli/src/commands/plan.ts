import { defineCommand } from 'citty';
import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';
import { renderPlanList, renderPlanStatus } from '../render/plan';

type PlanRow = RouteResponse<'plans'>['plans'][number];

const usageError = (message: string): Error => new Error(message);

/** The optional string a flag gives, or undefined when the flag is absent. */
const stringFlag = (args: Record<string, unknown>, name: string) =>
  args[name] === undefined ? undefined : String(args[name]);

/**
 * The plan a slug names (PROTOCOL §10). A slug is unique only within a project: `--project` picks the
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

/** `factory plan ls`: the plans, one row each. Read-only; `--json` prints `{plans}`. */
const listPlans = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const { plans } = await ctx.client.call('plans', {});
    if (ctx.json) return printJson({ plans });
    console.log(renderPlanList(plans, ctx.paint));
  });

/**
 * `factory plan status <slug> [--project <id>]`: the chain in order and the plan PR. The slug resolves
 * through the same `plans` list the other modes read, so local, remote and `--once` agree (RULES §6.5).
 */
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
  },
  run: ({ args }) => {
    // citty also runs the parent's `run` after a subcommand; only a bare `factory plan` lists here.
    if (args._.length > 0) return;
    return listPlans(args);
  },
});
