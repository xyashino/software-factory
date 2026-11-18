import { z } from 'zod';
import { MAX_WORKTREE_RESETS } from '../../config';

const STATION_KINDS = ['operator', 'inspection', 'deliver'] as const;

const stationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(STATION_KINDS),
  requiredFiles: z.array(z.string().min(1)),
  maxAttempts: z.number().int().positive(),
  onFailRetryStationId: z.string().min(1).optional(),
});

const lineSnapshotSchema = z
  .object({
    name: z.string().min(1),
    stations: z.array(stationSchema).min(1),
  })
  .superRefine((snapshot, ctx) => {
    const ids = snapshot.stations.map((station) => station.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'station ids must be unique',
        path: ['stations'],
      });
    }
    snapshot.stations.forEach((station, index) => {
      if (station.onFailRetryStationId === undefined) return;
      const target = ids.indexOf(station.onFailRetryStationId);
      if (target === -1 || target >= index) {
        ctx.addIssue({
          code: 'custom',
          message: 'onFailRetryStationId must name an earlier station',
          path: ['stations', index, 'onFailRetryStationId'],
        });
      }
    });
    if (snapshot.stations[snapshot.stations.length - 1]?.kind !== 'deliver') {
      ctx.addIssue({
        code: 'custom',
        message: 'the last station must be deliver',
        path: ['stations'],
      });
    }
  });

export type StationKind = (typeof STATION_KINDS)[number];

export type OrderStep = {
  stepIndex: number;
  stationId: string;
  kind: StationKind;
  requiredFiles: string[];
  maxAttempts: number;
  onFailRetryStationId: string | null;
  attemptsUsed: number;
};

export type BlockTrigger =
  'step_retries_exhausted' | 'delivery_failed' | 'worktree_reset_limit';

export type TransitionPlan =
  | { kind: 'retry'; stepIndex: number }
  | { kind: 'rewind'; stepIndex: number }
  | { kind: 'reset'; stepIndex: 0; workspaceMode: 'fresh' }
  | { kind: 'blocked'; trigger: BlockTrigger };

export type StepFailure = {
  attemptsUsed: number;
  plan: TransitionPlan;
};

export type WorktreeMissing = {
  worktreeResets: number;
  plan: TransitionPlan;
};

export class UnprocessableTransition extends Error {}

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

const findStepIndex = (
  steps: readonly OrderStep[],
  stationId: string,
): number => {
  const index = steps.findIndex((step) => step.stationId === stationId);
  if (index === -1) {
    throw new UnprocessableTransition(`no step for station ${stationId}`);
  }
  return index;
};

export const materializeLineSnapshot = (input: unknown): OrderStep[] => {
  const parsed = lineSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new UnprocessableTransition(
      parsed.error.issues[0]?.message ?? 'invalid line snapshot',
    );
  }
  return parsed.data.stations.map((station, stepIndex) => ({
    stepIndex,
    stationId: station.id,
    kind: station.kind,
    requiredFiles: station.requiredFiles,
    maxAttempts: station.maxAttempts,
    onFailRetryStationId: station.onFailRetryStationId ?? null,
    attemptsUsed: 0,
  }));
};

export const assertArtifactsProduced = (
  requiredFiles: readonly string[],
  producedFiles: readonly string[],
): void => {
  const missing = requiredFiles.filter((file) => !producedFiles.includes(file));
  if (missing.length > 0) {
    throw new UnprocessableTransition(
      `missing required files: ${missing.join(', ')}`,
    );
  }
};

export const planStepFailure = (
  steps: readonly OrderStep[],
  stepIndex: number,
): StepFailure => {
  const step = requireStep(steps, stepIndex);
  const attemptsUsed = step.attemptsUsed + 1;

  if (attemptsUsed < step.maxAttempts) {
    if (step.onFailRetryStationId === null) {
      return { attemptsUsed, plan: { kind: 'retry', stepIndex } };
    }
    return {
      attemptsUsed,
      plan: {
        kind: 'rewind',
        stepIndex: findStepIndex(steps, step.onFailRetryStationId),
      },
    };
  }

  return {
    attemptsUsed,
    plan: {
      kind: 'blocked',
      trigger:
        step.kind === 'deliver' ? 'delivery_failed' : 'step_retries_exhausted',
    },
  };
};

export const planWorktreeMissing = (
  worktreeResets: number,
): WorktreeMissing => {
  const resets = worktreeResets + 1;
  if (resets > MAX_WORKTREE_RESETS) {
    return {
      worktreeResets: resets,
      plan: { kind: 'blocked', trigger: 'worktree_reset_limit' },
    };
  }
  return {
    worktreeResets: resets,
    plan: { kind: 'reset', stepIndex: 0, workspaceMode: 'fresh' },
  };
};
