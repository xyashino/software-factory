import { z } from 'zod';
import { INCIDENT_ACTIONS } from '@repo/operator-protocol/constants';
import { defineVerb } from '../define-verb';

export const incident = defineVerb({
  name: 'incident',
  description: 'Act on the incident: retry, restart, escalate or cancel',
  args: z
    .object({
      action: z.enum(INCIDENT_ACTIONS),
      step: z.string().min(1).optional(),
      diagnosis: z.string().optional(),
      outcome: z.string().optional(),
    })
    .superRefine((args, ctx) => {
      if (args.action === 'restart_from_step' && args.step === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['step'],
          message: 'step is required for restart_from_step',
        });
      }
    }),
  readFiles: { report: { required: true } },
  toRequest: ({ action, step, diagnosis, outcome }, { report }) => ({
    verb: 'incident',
    action,
    step,
    diagnosis,
    outcome,
    report,
  }),
});
