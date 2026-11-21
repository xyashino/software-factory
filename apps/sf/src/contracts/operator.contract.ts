import { z } from 'zod';

const TOKEN_MIN_CHARS = 16;
const TOKEN_MAX_CHARS = 256;
const REASON_MAX_CHARS = 8192;
const TEXT_MAX_CHARS = 65536;

const tokenField = {
  token: z.string().trim().min(TOKEN_MIN_CHARS).max(TOKEN_MAX_CHARS),
};

export const doneVerb = z
  .object({ verb: z.literal('done'), ...tokenField })
  .strict();

export const verdictVerb = z
  .object({
    verb: z.literal('verdict'),
    outcome: z.enum(['pass', 'fail']),
    feedback: z.string().min(1).max(TEXT_MAX_CHARS).optional(),
    ...tokenField,
  })
  .strict()
  .superRefine((verdict, ctx) => {
    if (verdict.outcome === 'fail' && verdict.feedback === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'feedback is required when outcome is fail',
        path: ['feedback'],
      });
    }
  });

export const blockVerb = z
  .object({
    verb: z.literal('block'),
    reason: z.string().trim().min(1).max(REASON_MAX_CHARS),
    handover: z.string().min(1).max(TEXT_MAX_CHARS),
    ...tokenField,
  })
  .strict();

export const contextVerb = z
  .object({ verb: z.literal('context'), ...tokenField })
  .strict();

export const readVerb = z
  .object({ verb: z.literal('read'), ...tokenField })
  .strict();

export const incidentVerb = z
  .object({
    verb: z.literal('incident'),
    action: z.enum([
      'retry_step',
      'restart_from_step',
      'restart_from_scratch',
      'escalate',
      'cancel',
    ]),
    step: z.string().trim().min(1).optional(),
    diagnosis: z.string().trim().min(1),
    outcome: z.string().trim().min(1),
    report: z.string().min(1).max(TEXT_MAX_CHARS),
    ...tokenField,
  })
  .strict()
  .superRefine((incident, ctx) => {
    if (
      incident.action === 'restart_from_step' &&
      incident.step === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'step is required when action is restart_from_step',
        path: ['step'],
      });
    }
  });

export const operatorRequest = z.union([
  doneVerb,
  verdictVerb,
  blockVerb,
  contextVerb,
  readVerb,
  incidentVerb,
]);
