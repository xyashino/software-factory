import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decidePlan } from '../decide';
import type { PlanCommand } from '../commands';
import { evolvePlan } from '../evolve';
import { planNextJob } from '../next-job';
import type { PlanState } from '../state';
import {
  COMMIT,
  CELL,
  JOB,
  PR_URL,
  RESUME,
  SUPERVISOR,
  cellActor,
  created,
  ctxOf,
  fold,
  orderOf,
  run,
  stored,
  todoOf,
} from './harness';
import type { PlanEvent } from '../events';

const RUNS = Number(process.env['FACTORY_PROPERTY_RUNS'] ?? 200);

type Step = {
  kind:
    | 'add'
    | 'memberState'
    | 'claim'
    | 'report'
    | 'fail'
    | 'prState'
    | 'expire'
    | 'raise'
    | 'resume'
    | 'cancel';
  n: number;
  memberState: 'open' | 'delivered' | 'merged' | 'closed' | 'cancelled';
  prState: 'open' | 'merged' | 'closed';
  stale: boolean;
};

const stepArb: fc.Arbitrary<Step> = fc.record({
  kind: fc.constantFrom<Step['kind']>(
    'add',
    'memberState',
    'claim',
    'report',
    'fail',
    'prState',
    'expire',
    'raise',
    'resume',
    'cancel',
  ),
  n: fc.integer({ min: 1, max: 4 }),
  memberState: fc.constantFrom(
    'open',
    'delivered',
    'merged',
    'closed',
    'cancelled',
  ),
  prState: fc.constantFrom('open', 'merged', 'closed'),
  stale: fc.boolean(),
});

/** Turns a step into a command against the current state, or nothing for a raise. */
const commandOf = (state: PlanState, step: Step): PlanCommand | undefined => {
  const job = state.activeJob;
  const last = state.members[state.members.length - 1]?.orderId;
  switch (step.kind) {
    case 'add':
      return {
        type: 'AddPlanMember',
        orderId: orderOf(`wo-${step.n}`),
        todoId: todoOf(`wo-${step.n}`),
        ...(step.stale || last === undefined ? {} : { after: last }),
      };
    case 'memberState':
      return {
        type: 'RecordMemberState',
        orderId: orderOf(`wo-${step.n}`),
        state: step.memberState,
      };
    case 'claim':
      return { type: 'ClaimJob', cellId: CELL };
    case 'report':
      if (job?.kind === 'plan_pr')
        return { type: 'ReportPlanPr', prUrl: PR_URL };
      if (job?.kind === 'plan_pr_ready') return { type: 'ReportPlanReady' };
      return { type: 'ReportPlanBranch', commit: COMMIT };
    case 'fail':
      return { type: 'ReportPlanJobFailed', detail: 'boom' };
    case 'prState':
      return {
        type: 'RecordPlanPrState',
        prUrl: state.pr?.url ?? PR_URL,
        state: step.prState,
      };
    case 'expire':
      return {
        type: 'ExpireLease',
        jobId: job?.jobId ?? JOB(1),
        epoch: job?.epoch ?? 1,
      };
    case 'resume':
      return { type: 'Resume', resumeId: RESUME, by: 'alice' };
    case 'cancel':
      return { type: 'Cancel', reason: 'stop' };
    case 'raise':
      return undefined;
  }
};

/** The context a step runs under: a cell with the active epoch, or a stale one, or the supervisor. */
const ctxFor = (state: PlanState, step: Step) => {
  if (step.kind === 'resume' || step.kind === 'cancel')
    return ctxOf(SUPERVISOR);
  if (
    step.kind === 'memberState' ||
    step.kind === 'add' ||
    step.kind === 'claim' ||
    step.kind === 'prState'
  ) {
    return ctxOf();
  }
  if (step.kind === 'expire') return ctxOf();
  const epoch = step.stale ? state.epoch + 5 : (state.activeJob?.epoch ?? 1);
  return ctxOf(cellActor(), epoch);
};

/** Every invariant of CORE §12.10 that a single state must satisfy. Returns the violations. */
const violations = (state: PlanState, previousEpoch: number): string[] => {
  const broken: string[] = [];
  const ids = state.members.map((m) => m.orderId);
  // P4: linear chain, no duplicate member.
  if (new Set(ids).size !== ids.length) broken.push('P4 duplicate member');
  state.members.forEach((member, index) => {
    const expected = index === 0 ? undefined : ids[index - 1];
    if (member.after !== expected)
      broken.push(`P4 member ${index} has the wrong predecessor`);
  });
  // P2: the plan PR exists only once the root is merged, and the root cannot regress.
  if (state.pr && state.members[0]?.state !== 'merged')
    broken.push('P2 PR before root merged');
  // P5: ready and completed follow a PR; completed means the PR merged.
  const phase = state.phase.kind;
  if ((phase === 'ready' || phase === 'completed') && !state.pr)
    broken.push('P5 ready without PR');
  if (phase === 'completed' && state.pr?.state !== 'merged')
    broken.push('P5 completed without merge');
  // P6: epochs never go back; a job, if active, holds the last issued epoch.
  if (state.epoch < previousEpoch) broken.push('P6 epoch went back');
  if (state.activeJob && state.activeJob.epoch !== state.epoch)
    broken.push('P6 active job is not the last epoch');
  // P7: a live plan always has a next step; an Andon waits for the supervisor.
  const next = planNextJob(state);
  if (
    (phase === 'branching' ||
      phase === 'active' ||
      phase === 'pr_open' ||
      phase === 'ready') &&
    next.kind === 'done'
  ) {
    broken.push('P7 live plan is done');
  }
  if (state.andon && !state.activeJob && next.kind !== 'await_supervisor') {
    broken.push('P7 Andon without await_supervisor');
  }
  return broken;
};

describe('Order Plan properties (CORE §12.10, RULES §1.4)', () => {
  it('P1–P7 and determinism hold along any command sequence', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 30 }), (steps) => {
        let state: PlanState = fold([created()]);
        let previousEpoch = 0;
        for (const step of steps) {
          if (step.kind === 'raise') {
            const next = planNextJob(state);
            if (next.kind === 'raise_andon') {
              const event: PlanEvent = {
                type: 'andon_raised',
                reason: next.reason,
                detail: next.detail,
              };
              state = evolvePlan(state, stored(1000, event));
            }
          } else {
            const command = commandOf(state, step);
            if (command) {
              // I1: the same state, command and context decide the same events.
              expect(decidePlan(state, command, ctxFor(state, step))).toEqual(
                decidePlan(state, command, ctxFor(state, step)),
              );
              const before = state;
              const outcome = run(state, command, ctxFor(state, step));
              if (outcome.ok) {
                // P1: a second plan PR needs the first one closed and resumed away.
                if (outcome.events.some((e) => e.type === 'plan_pr_opened')) {
                  expect(before.pr).toBeUndefined();
                }
                if (outcome.state) state = outcome.state;
                if (command.type === 'Resume') {
                  // P7: after resume the Andon it cleared is not raised again at once.
                  expect(planNextJob(state).kind).not.toBe('await_supervisor');
                  expect(planNextJob(state).kind).not.toBe('raise_andon');
                }
              }
            }
          }
          expect(violations(state, previousEpoch)).toEqual([]);
          previousEpoch = state.epoch;
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('a root that is not merged never gets the plan_pr job (P2 through nextJob)', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 20 }), (steps) => {
        let state: PlanState = fold([created()]);
        for (const step of steps) {
          const command = commandOf(state, step);
          if (!command) continue;
          const outcome = run(state, command, ctxFor(state, step));
          if (outcome.ok && outcome.state) state = outcome.state;
          if (state.members[0]?.state !== 'merged' && state.pr === undefined) {
            expect(planNextJob(state)).not.toEqual({
              kind: 'job',
              job: { kind: 'plan_pr' },
            });
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
