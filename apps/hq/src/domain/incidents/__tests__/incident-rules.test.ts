import { describe, expect, it } from 'vitest';
import { MAX_MECHANIC_RUNS } from '../../../config';
import {
  materializeLineSnapshot,
  planStepFailure,
  UnprocessableTransition,
  type OrderStep,
} from '../../orders/job-transitions';
import {
  resolveIncident,
  triageIncident,
  type IncidentReason,
  type IncidentSnapshot,
  type TriageOwner,
  type WorkOrderSnapshot,
} from '../incident-rules';

const buildSteps = (): OrderStep[] =>
  materializeLineSnapshot({
    name: 'feature',
    stations: [
      {
        id: 'plan',
        kind: 'operator',
        requiredFiles: ['plan.md'],
        maxAttempts: 2,
      },
      {
        id: 'build',
        kind: 'operator',
        requiredFiles: ['commit.md'],
        maxAttempts: 2,
      },
      {
        id: 'deliver',
        kind: 'deliver',
        requiredFiles: ['deliver.json'],
        maxAttempts: 1,
      },
    ],
  });

const withAttemptsUsed = (
  steps: OrderStep[],
  attemptsUsed: number,
): OrderStep[] => steps.map((step) => ({ ...step, attemptsUsed }));

const workOrder = (
  overrides: Partial<WorkOrderSnapshot> = {},
): WorkOrderSnapshot => ({
  state: 'blocked',
  currentStepIndex: 1,
  mechanicRuns: 0,
  pinnedFactoryId: 'factory-a',
  unavailableLineFactories: ['factory-b'],
  staleBase: 1,
  worktreeResets: 2,
  steps: buildSteps(),
  ...overrides,
});

const incident = (
  overrides: Partial<IncidentSnapshot> = {},
): IncidentSnapshot => ({
  status: 'triaging',
  triageOwner: 'mechanic',
  failedStepIndex: 1,
  resolutionAction: null,
  ...overrides,
});

const triggers: ReadonlyArray<readonly [IncidentReason, TriageOwner]> = [
  ['step_retries_exhausted', 'mechanic'],
  ['operator_blocked', 'mechanic'],
  ['workspace_failed', 'mechanic'],
  ['worktree_reset_limit', 'mechanic'],
  ['delivery_failed', 'mechanic'],
  ['parent_rebased', 'mechanic'],
  ['line_unavailable', 'operator'],
];

describe('incident triage', () => {
  it.each(triggers)('routes %s to the %s owner', (reason, owner) => {
    const result = triageIncident(reason, workOrder());

    expect(result.incident.triageOwner).toBe(owner);
    expect(result.incident.status).toBe('triaging');
  });

  it('pins the mechanic job to the pinned cell and counts the run', () => {
    const result = triageIncident('operator_blocked', workOrder());

    expect(result.mechanicJob).toEqual({ pinnedFactoryId: 'factory-a' });
    expect(result.workOrder.mechanicRuns).toBe(1);
  });

  it('keeps the mechanic run count when a line is unavailable', () => {
    const result = triageIncident('line_unavailable', workOrder());

    expect(result.mechanicJob).toBeNull();
    expect(result.workOrder.mechanicRuns).toBe(0);
  });

  it('plans the last mechanic job, then hands the next incident to the operator', () => {
    const last = triageIncident(
      'operator_blocked',
      workOrder({ mechanicRuns: MAX_MECHANIC_RUNS - 1 }),
    );
    const afterBudget = triageIncident('operator_blocked', last.workOrder);

    expect(last.mechanicJob).not.toBeNull();
    expect(afterBudget.incident.triageOwner).toBe('operator');
    expect(afterBudget.mechanicJob).toBeNull();
  });

  it('gives the operator the incident when no cell is pinned', () => {
    const result = triageIncident(
      'operator_blocked',
      workOrder({ pinnedFactoryId: null }),
    );

    expect(result.incident.triageOwner).toBe('operator');
    expect(result.mechanicJob).toBeNull();
  });
});

describe('incident resolutions', () => {
  it('retry_step grants one more attempt and requeues from that step', () => {
    const steps = withAttemptsUsed(buildSteps(), 1);
    const result = resolveIncident(
      incident(),
      workOrder({ steps, unavailableLineFactories: ['factory-b'] }),
      { action: 'retry_step', stepIndex: 1 },
    );

    expect(result.workOrder).toMatchObject({
      state: 'queued',
      currentStepIndex: 1,
      unavailableLineFactories: [],
      pinnedFactoryId: 'factory-a',
    });
    expect(result.incident).toMatchObject({
      status: 'resolved',
      resolutionAction: 'retry_step',
    });
  });

  it('retry_step lets the failed step fail again instead of blocking', () => {
    const steps = withAttemptsUsed(buildSteps(), 1);
    const result = resolveIncident(incident(), workOrder({ steps }), {
      action: 'retry_step',
      stepIndex: 1,
    });

    expect(planStepFailure(steps, 1).plan.kind).toBe('blocked');
    expect(planStepFailure(result.workOrder.steps, 1)).toEqual({
      attemptsUsed: 2,
      plan: { kind: 'retry', stepIndex: 1 },
    });
  });

  it('restart_from_step rewinds and resets attempts from that step on', () => {
    const steps = withAttemptsUsed(buildSteps(), 1);
    const result = resolveIncident(
      incident({ failedStepIndex: 2 }),
      workOrder({ steps, currentStepIndex: 2 }),
      { action: 'restart_from_step', stepIndex: 1 },
    );

    expect(result.workOrder.currentStepIndex).toBe(1);
    expect(result.workOrder.state).toBe('queued');
    expect(result.workOrder.steps.map((step) => step.attemptsUsed)).toEqual([
      1, 0, 0,
    ]);
    expect(result.incident.status).toBe('resolved');
  });

  it('restart_from_step refuses a step after the failed one', () => {
    const act = () =>
      resolveIncident(incident({ failedStepIndex: 1 }), workOrder(), {
        action: 'restart_from_step',
        stepIndex: 2,
      });

    expect(act).toThrow(UnprocessableTransition);
  });

  it('restart_from_step refuses a negative step', () => {
    const act = () =>
      resolveIncident(incident(), workOrder(), {
        action: 'restart_from_step',
        stepIndex: -1,
      });

    expect(act).toThrow(UnprocessableTransition);
  });

  it('restart_from_scratch resets the workspace and requeues fresh', () => {
    const steps = withAttemptsUsed(buildSteps(), 1);
    const result = resolveIncident(
      incident({ failedStepIndex: 2 }),
      workOrder({ steps, currentStepIndex: 2 }),
      { action: 'restart_from_scratch' },
    );

    expect(result.workspaceMode).toBe('fresh');
    expect(result.workOrder).toMatchObject({
      state: 'queued',
      currentStepIndex: 0,
      worktreeResets: 0,
      staleBase: 0,
      unavailableLineFactories: [],
    });
    expect(
      result.workOrder.steps.every((step) => step.attemptsUsed === 0),
    ).toBe(true);
  });

  it('escalate hands the incident to the operator and leaves the order blocked', () => {
    const result = resolveIncident(incident(), workOrder(), {
      action: 'escalate',
    });

    expect(result.incident).toMatchObject({
      status: 'escalated',
      triageOwner: 'operator',
      resolutionAction: 'escalate',
    });
    expect(result.workOrder.state).toBe('blocked');
  });

  it('cancel ends the incident and the order and releases the pinned cell', () => {
    const result = resolveIncident(incident(), workOrder(), {
      action: 'cancel',
    });

    expect(result.incident).toMatchObject({
      status: 'cancelled',
      resolutionAction: 'cancel',
    });
    expect(result.workOrder).toMatchObject({
      state: 'cancelled',
      pinnedFactoryId: null,
    });
  });

  it('refuses to resolve an incident that is already resolved', () => {
    const act = () =>
      resolveIncident(incident({ status: 'resolved' }), workOrder(), {
        action: 'retry_step',
        stepIndex: 1,
      });

    expect(act).toThrow(UnprocessableTransition);
  });

  it('refuses to cancel an incident that is already cancelled', () => {
    const act = () =>
      resolveIncident(incident({ status: 'cancelled' }), workOrder(), {
        action: 'cancel',
      });

    expect(act).toThrow(UnprocessableTransition);
  });
});
