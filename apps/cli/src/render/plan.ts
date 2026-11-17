import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { Paint } from './paint';

type PlanRow = RouteResponse<'plans'>['plans'][number];
type PlanDetail = RouteResponse<'planDetail'>;
type PlanMember = PlanDetail['members'][number];

// The plan PR state, as the row carries it; `not opened` until intake or `plan_pr` opens one.
const prStateOf = (plan: PlanRow): string => plan.prState ?? 'not opened';

/**
 * `factory plan ls`: one row per plan: slug, project, member count, phase and the plan
 * PR state. An empty registry says so on one line.
 */
export const renderPlanList = (
  rows: readonly PlanRow[],
  paint: Paint,
): string => {
  if (rows.length === 0) return 'no plans';
  const header = `${'SLUG'.padEnd(20)} ${'PROJECT'.padEnd(20)} ${'MEMBERS'.padEnd(8)} ${'PHASE'.padEnd(14)} PLAN PR`;
  const lines = rows.map(
    (plan) =>
      `${plan.slug.padEnd(20)} ${plan.projectId.padEnd(20)} ${String(plan.memberCount).padEnd(8)} ${plan.phase.padEnd(14)} ${prStateOf(plan)}`,
  );
  return [paint.dim(header), ...lines].join('\n');
};

// One member's label in the chain: its board status, the PR into a non-plan base when it is delivered
// (`PR into factory/wo-1`), and its blocker when it has one. Members stay in chain order.
const chainItem = (member: PlanMember, planBranch: string): string => {
  const status = member.status ?? member.state;
  const parts: string[] = [];
  if (
    status === 'delivered' &&
    member.prUrl &&
    member.baseBranch &&
    member.baseBranch !== planBranch
  ) {
    parts.push(`${status}, PR into ${member.baseBranch}`);
  } else {
    parts.push(status);
  }
  if (member.blocker) parts.push(member.blocker);
  return `${member.todoId} [${parts.join(', ')}]`;
};

/**
 * `factory plan status <slug>`: the header, the chain in order, one line per member with
 * its base and PR, then the plan PR and any Andon with the command that clears it.
 */
export const renderPlanStatus = (detail: PlanDetail, paint: Paint): string => {
  const { plan, members } = detail;
  const lines = [
    `${paint.bold(plan.slug)}  ${plan.projectId}  ${plan.phase}`,
    members.length === 0
      ? '  (no members)'
      : `  ${members.map((member) => chainItem(member, plan.branch)).join(' -> ')}`,
  ];
  for (const member of members) {
    const pr = member.prUrl ?? '-';
    const blocker = member.blocker ? `  blocker ${member.blocker}` : '';
    lines.push(
      `    ${member.todoId.padEnd(12)} ${(member.status ?? member.state).padEnd(12)} base ${member.baseBranch ?? '-'}  PR ${pr}${blocker}`,
    );
  }
  const planPr = plan.prUrl ? ` ${plan.prUrl}` : '';
  lines.push(
    `plan PR: ${plan.branch} -> ${plan.baseBranch} (${prStateOf(plan)})${planPr}`,
  );
  if (plan.andonReason) {
    lines.push(
      paint.red(`andon: ${plan.andonReason}`),
      `  factory resume ${plan.planId}  or  factory cancel ${plan.planId}`,
    );
  }
  return lines.join('\n');
};
