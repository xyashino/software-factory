import { z } from 'zod';
import { INCIDENT_ACTIONS } from '../constants';
import { replySchemas } from '../replies';

const token = z.string().min(16).max(256);

const incidentBody = z
  .object({
    verb: z.literal('incident'),
    action: z.enum(INCIDENT_ACTIONS),
    step: z.string().min(1).optional(),
    diagnosis: z.string().optional(),
    outcome: z.string().optional(),
    report: z.string().min(1).max(65536),
    token,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.action === 'restart_from_step' && body.step === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['step'],
        message: 'step is required for restart_from_step',
      });
  });

export const readContract = {
  body: z.object({ verb: z.literal('read'), token }).strict(),
  replies: replySchemas,
};

export const incidentContract = {
  body: incidentBody,
  replies: replySchemas,
};
