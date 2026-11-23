import {
  INCIDENT_REASONS,
  INCIDENT_STATUSES,
} from '@repo/hq-contracts/enums/incidents';
import { MAX_MECHANIC_RUNS } from '../../config';
import {
  UnprocessableTransition,
  type OrderStep,
} from '../orders/job-transitions';
import type { WorkOrderState } from '../orders/order-state';

export type IncidentReason = (typeof INCIDENT_REASONS)[number];

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type TriageOwner = 'mechanic' | 'supervisor';

export type Resolution =
  | { action: 'retry_step'; stepIndex: number }
  | { action: 'restart_from_step'; stepIndex: number }
  | { action: 'restart_from_scratch' }
  | { action: 'escalate' }
  | { action: 'cancel' };

export type ResolutionAction = Resolution['action'];

export type WorkOrderSnapshot = {
  state: WorkOrderState;
  currentStepIndex: number;
  mechanicRuns: number;
  pinnedFactoryId: string | null;
  unavailableLineFactories: string[];
  staleBase: number;
  worktreeResets: number;
  steps: OrderStep[];
};

export type IncidentSnapshot = {
  status: IncidentStatus;
  triageOwner: TriageOwner;
  failedStepIndex: number | null;
  resolutionAction: ResolutionAction | null;
};

export type TriageResult = {
  incident: IncidentSnapshot;
  workOrder: WorkOrderSnapshot;
  mechanicJob: { pinnedFactoryId: string } | null;
};

export type ResolutionResult = {
  incident: IncidentSnapshot;
  workOrder: WorkOrderSnapshot;
  workspaceMode: 'fresh' | 'keep';
};

const requireStep = (
  steps: readonly OrderStep[],
  stepIndex: number,
): OrderStep => {
  const step = steps[stepIndex];
  if (step === undefined) {
    throw new UnprocessableTransition(`no step at index ${stepIndex}`);
  }
  return step;
};

const requireFailedStepIndex = (incident: IncidentSnapshot): number => {
  if (incident.failedStepIndex === null) {
    throw new UnprocessableTransition('incident has no failed step');
  }
  return incident.failedStepIndex;
};

const assertUnresolved = (incident: IncidentSnapshot): void => {
  if (
    incident.status !== 'open' &&
    incident.status !== 'triaging' &&
    incident.status !== 'escalated'
  ) {
    throw new UnprocessableTransition(`incident is ${incident.status}`);
  }
};

const resetAttemptsFrom = (
  steps: readonly OrderStep[],
  fromIndex: number,
): OrderStep[] =>
  steps.map((step) =>
    step.stepIndex >= fromIndex ? { ...step, attemptsUsed: 0 } : step,
  );

const resolvedIncident = (
  incident: IncidentSnapshot,
  action: ResolutionAction,
): IncidentSnapshot => ({
  ...incident,
  status: 'resolved',
  resolutionAction: action,
});

export const triageIncident = (
  reason: IncidentReason,
  workOrder: WorkOrderSnapshot,
): TriageResult => {
  const failedStepIndex = workOrder.currentStepIndex;
  const pinnedFactoryId = workOrder.pinnedFactoryId;

  if (
    reason === 'line_unavailable' ||
    workOrder.mechanicRuns >= MAX_MECHANIC_RUNS ||
    pinnedFactoryId === null
  ) {
    return {
      incident: {
        status: 'triaging',
        triageOwner: 'supervisor',
        failedStepIndex,
        resolutionAction: null,
      },
      workOrder,
      mechanicJob: null,
    };
  }

  return {
    incident: {
      status: 'triaging',
      triageOwner: 'mechanic',
      failedStepIndex,
      resolutionAction: null,
    },
    workOrder: { ...workOrder, mechanicRuns: workOrder.mechanicRuns + 1 },
    mechanicJob: { pinnedFactoryId },
  };
};

export const resolveIncident = (
  incident: IncidentSnapshot,
  workOrder: WorkOrderSnapshot,
  resolution: Resolution,
): ResolutionResult => {
  assertUnresolved(incident);

  switch (resolution.action) {
    case 'retry_step': {
      requireStep(workOrder.steps, resolution.stepIndex);
      // Raising the cap grants one more attempt; attempts already used stay counted.
      const steps = workOrder.steps.map((step) =>
        step.stepIndex === resolution.stepIndex
          ? { ...step, maxAttempts: step.maxAttempts + 1 }
          : step,
      );
      return {
        incident: resolvedIncident(incident, resolution.action),
        workOrder: {
          ...workOrder,
          state: 'queued',
          currentStepIndex: resolution.stepIndex,
          unavailableLineFactories: [],
          steps,
        },
        workspaceMode: 'keep',
      };
    }
    case 'restart_from_step': {
      const failedStepIndex = requireFailedStepIndex(incident);
      if (resolution.stepIndex < 0 || resolution.stepIndex > failedStepIndex) {
        throw new UnprocessableTransition(
          `restart step ${resolution.stepIndex} is outside 0..${failedStepIndex}`,
        );
      }
      requireStep(workOrder.steps, resolution.stepIndex);
      return {
        incident: resolvedIncident(incident, resolution.action),
        workOrder: {
          ...workOrder,
          state: 'queued',
          currentStepIndex: resolution.stepIndex,
          steps: resetAttemptsFrom(workOrder.steps, resolution.stepIndex),
        },
        workspaceMode: 'keep',
      };
    }
    case 'restart_from_scratch':
      return {
        incident: resolvedIncident(incident, resolution.action),
        workOrder: {
          ...workOrder,
          state: 'queued',
          currentStepIndex: 0,
          worktreeResets: 0,
          staleBase: 0,
          unavailableLineFactories: [],
          steps: resetAttemptsFrom(workOrder.steps, 0),
        },
        workspaceMode: 'fresh',
      };
    case 'escalate':
      return {
        incident: {
          ...incident,
          status: 'escalated',
          triageOwner: 'supervisor',
          resolutionAction: resolution.action,
        },
        workOrder,
        workspaceMode: 'keep',
      };
    case 'cancel':
      return {
        incident: {
          ...incident,
          status: 'cancelled',
          resolutionAction: resolution.action,
        },
        workOrder: { ...workOrder, state: 'cancelled', pinnedFactoryId: null },
        workspaceMode: 'keep',
      };
    default: {
      const _exhaustive: never = resolution;
      return _exhaustive;
    }
  }
};
