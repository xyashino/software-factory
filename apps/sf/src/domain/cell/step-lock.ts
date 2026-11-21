import { z } from 'zod';

const StepLockSchema = z.object({
  runId: z.string().min(1),
  pid: z.number().int().positive().nullable(),
  pidStartedAt: z.string().nullable(),
  pane: z.string().nullable(),
  startedAt: z.number().int(),
});

export type StepLock = z.infer<typeof StepLockSchema>;

export type LockVerdict = 'live' | 'stale';

// A null pid means the runner could not be identified, so its liveness is unknown and the step stays held.
export const lockVerdictOf = (
  lock: StepLock,
  observedStartedAt: string | null,
): LockVerdict => {
  if (lock.pid === null) return 'live';
  if (observedStartedAt === null) return 'stale';
  return observedStartedAt === lock.pidStartedAt ? 'live' : 'stale';
};

export const parseStepLock = (record: unknown): StepLock | null => {
  const parsed = StepLockSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
};
