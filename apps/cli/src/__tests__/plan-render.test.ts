import { describe, expect, it } from 'vitest';
import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { OrderId, PlanId } from '@repo/factory-core/ids';
import { planCommand, resolvePlan } from '../commands/plan';
import { renderPlanList, renderPlanStatus } from '../render/plan';
import { plainPaint } from '../render/paint';
import { usage } from '../usage';

type Detail = RouteResponse<'planDetail'>;
type PlanRow = RouteResponse<'plans'>['plans'][number];

const planRow = (overrides: Partial<PlanRow> = {}): PlanRow => ({
  planId: 'software-factory:plan:e2e' as PlanId,
  projectId: 'software-factory',
  slug: 'e2e',
  branch: 'feat/e2e',
  baseBranch: 'main',
  phase: 'pr_open',
  holder: 'members',
  nextKind: 'wait_external',
  jobKind: null,
  memberCount: 3,
  prUrl: null,
  prState: null,
  andonReason: null,
  updatedAt: 1,
  ...overrides,
});

/** The stacked state of the e2e test: wo-1 merged, wo-2 delivered into factory/wo-1, wo-3 running. */
const stacked = (overrides: Partial<Detail> = {}): Detail => ({
  plan: planRow({ prUrl: 'https://github.test/pr/9', prState: 'open' }),
  members: [
    {
      orderId: 'software-factory:todo-wo-1' as OrderId,
      todoId: 'wo-1',
      after: null,
      state: 'merged',
      status: 'merged',
      baseBranch: 'feat/e2e',
      prUrl: 'https://github.test/pr/1',
      blocker: null,
    },
    {
      orderId: 'software-factory:todo-wo-2' as OrderId,
      todoId: 'wo-2',
      after: 'software-factory:todo-wo-1' as OrderId,
      state: 'active',
      status: 'delivered',
      baseBranch: 'factory/wo-1',
      prUrl: 'https://github.test/pr/2',
      blocker: null,
    },
    {
      orderId: 'software-factory:todo-wo-3' as OrderId,
      todoId: 'wo-3',
      after: 'software-factory:todo-wo-2' as OrderId,
      state: 'active',
      status: 'running',
      baseBranch: 'factory/wo-2',
      prUrl: null,
      blocker: 'waiting_deps',
    },
  ],
  ...overrides,
});

describe('plan ls rendering', () => {
  it('prints a table with slug, project, members, phase and plan PR', () => {
    const out = renderPlanList([planRow({ prState: 'open' })], plainPaint);
    const [header, row] = out.split('\n');
    expect(header).toContain('SLUG');
    expect(header).toContain('MEMBERS');
    expect(header).toContain('PLAN PR');
    expect(row).toContain('e2e');
    expect(row).toContain('software-factory');
    expect(row).toContain('pr_open');
    expect(row?.trimEnd().endsWith('open')).toBe(true);
  });

  it('says no plans on an empty registry', () => {
    expect(renderPlanList([], plainPaint)).toBe('no plans');
  });

  it('shows "not opened" while no plan PR exists', () => {
    expect(renderPlanList([planRow()], plainPaint)).toContain('not opened');
  });
});

describe('plan status rendering', () => {
  it('prints the chain in order with the stacked base and the PR into it', () => {
    const out = renderPlanStatus(stacked(), plainPaint);
    expect(out).toContain(
      'wo-1 [merged] -> wo-2 [delivered, PR into factory/wo-1] -> wo-3 [running, waiting_deps]',
    );
  });

  it('keeps the header on the first line: slug, project, phase', () => {
    const [first] = renderPlanStatus(stacked(), plainPaint).split('\n');
    expect(first).toBe('e2e  software-factory  pr_open');
  });

  it('prints each member with its base, PR and blocker', () => {
    const out = renderPlanStatus(stacked(), plainPaint);
    expect(out).toContain('wo-2');
    expect(out).toContain('base factory/wo-1');
    expect(out).toContain('PR https://github.test/pr/2');
    expect(out).toContain('blocker waiting_deps');
  });

  it('shows the plan PR line with its state and URL', () => {
    const out = renderPlanStatus(stacked(), plainPaint);
    expect(out).toContain(
      'plan PR: feat/e2e -> main (open) https://github.test/pr/9',
    );
  });

  it('shows the Andon and the command that clears it', () => {
    const out = renderPlanStatus(
      stacked({
        plan: planRow({
          phase: 'andon',
          andonReason: 'plan_job_failed',
          planId: 'software-factory:plan:e2e' as PlanId,
        }),
      }),
      plainPaint,
    );
    expect(out).toContain('andon: plan_job_failed');
    expect(out).toContain(
      'factory resume software-factory:plan:e2e  or  factory cancel software-factory:plan:e2e',
    );
  });

  it('does not name a PR into the plan branch as a stacked base', () => {
    const out = renderPlanStatus(stacked(), plainPaint);
    expect(out).toContain('wo-1 [merged]');
    expect(out).not.toContain('PR into feat/e2e');
  });
});

describe('resolvePlan', () => {
  const plans = [
    planRow(),
    planRow({
      planId: 'other:plan:e2e' as PlanId,
      projectId: 'other',
    }),
    planRow({
      planId: 'software-factory:plan:solo' as PlanId,
      slug: 'solo',
    }),
  ];

  it('finds a unique slug without --project', () => {
    expect(resolvePlan(plans, 'solo').planId).toBe(
      'software-factory:plan:solo',
    );
  });

  it('picks the project when the slug is in more than one', () => {
    expect(resolvePlan(plans, 'e2e', 'other').planId).toBe('other:plan:e2e');
  });

  it('refuses an ambiguous slug without --project and names the projects', () => {
    expect(() => resolvePlan(plans, 'e2e')).toThrow(
      /more than one project \(software-factory, other\); pass --project/,
    );
  });

  it('reports a slug that matches no plan', () => {
    expect(() => resolvePlan(plans, 'nope')).toThrow('no plan "nope"');
  });

  it('reports a slug that matches no plan in the named project', () => {
    expect(() => resolvePlan(plans, 'solo', 'other')).toThrow(
      'no plan "solo" in project other',
    );
  });
});

describe('factory plan command tree', () => {
  it('registers ls, status and create subcommands', () => {
    const subCommands = planCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subCommands).sort()).toEqual(['create', 'ls', 'status']);
  });

  it('documents plan ls and plan status in usage', () => {
    expect(usage).toContain('factory plan ls');
    expect(usage).toContain('factory plan status <slug> [--project <id>]');
  });
});
