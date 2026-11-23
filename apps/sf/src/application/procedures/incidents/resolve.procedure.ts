import { z } from 'zod';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

export const RESOLVE_ACTIONS = [
  'retry_step',
  'restart_from_step',
  'restart_from_scratch',
  'escalate',
  'cancel',
] as const;

const STEP_ACTIONS: readonly string[] = ['retry_step', 'restart_from_step'];
const STEP_PATTERN = /^\d+$/;

const ResolveSchema = z
  .object({
    incidentId: z.string().trim().min(1),
    action: z.enum(RESOLVE_ACTIONS),
    step: z.string().optional(),
    report: z.string().optional(),
  })
  .strict();

const ResolveReplySchema = z.object({
  incident: z.object({
    incidentId: z.string(),
    status: z.string(),
    resolutionAction: z.string().nullable(),
  }),
  workOrder: z.object({ orderId: z.string(), state: z.string() }),
});

export interface ResolveResult {
  incident: {
    incidentId: string;
    status: string;
    resolutionAction: string | null;
  };
  workOrder: { orderId: string; state: string };
}

const parseStepIndex = (step: string | undefined): number | undefined => {
  if (step === undefined) {
    return undefined;
  }
  if (!STEP_PATTERN.test(step)) {
    throw new ArgumentError(
      `--step must be a non-negative integer, got ${step}`,
    );
  }
  return Number(step);
};

export const resolveIncident = define({ kind: 'operator' })(
  ResolveSchema,
)<ResolveResult>(async (input, ctx) => {
  if (input.report !== undefined) {
    throw new ArgumentError(
      '--report is not accepted by the server yet: the resolve contract has no report field',
    );
  }
  const stepIndex = parseStepIndex(input.step);
  const takesStep = STEP_ACTIONS.includes(input.action);
  if (takesStep && stepIndex === undefined) {
    throw new ArgumentError(`${input.action} requires --step <index>`);
  }
  if (!takesStep && stepIndex !== undefined) {
    throw new ArgumentError(
      '--step only applies to retry_step and restart_from_step',
    );
  }
  const secret = await readSecret(ctx);
  const body =
    stepIndex === undefined
      ? { action: input.action }
      : { action: input.action, stepIndex };
  return ResolveReplySchema.parse(
    await ctx.hq.call(
      `/api/v1/incidents/${encodeURIComponent(input.incidentId)}/resolve`,
      body,
      secret,
    ),
  );
});
