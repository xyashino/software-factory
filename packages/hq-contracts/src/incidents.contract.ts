import { z } from 'zod';
import { idParams } from '@repo/zod-contract-kit/fields';
import { projectIdSchema } from './common';
import { INCIDENT_REASONS, INCIDENT_STATUSES } from './enums/incidents';
import { workOrderDto } from './work-orders.contract';

const incidentDto = z.object({
  incidentId: z.string(),
  projectId: z.string(),
  orderId: z.string(),
  failedStepId: z.string().nullable(),
  failedJobId: z.string().nullable(),
  reason: z.enum(INCIDENT_REASONS),
  detail: z.string(),
  status: z.enum(INCIDENT_STATUSES),
  triageOwner: z.enum(['mechanic', 'operator']),
  diagnosis: z.string().nullable(),
  resolutionAction: z
    .enum([
      'retry_step',
      'restart_from_step',
      'restart_from_scratch',
      'escalate',
      'cancel',
    ])
    .nullable(),
  resolvedBy: z.string().nullable(),
  createdAt: z.number().int(),
  resolvedAt: z.number().int().nullable(),
});

const epochSchema = z.number().int().optional();
const stepIndexSchema = z.number().int().min(0);

const resolveIncidentBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('retry_step'),
    stepIndex: stepIndexSchema,
    epoch: epochSchema,
  }),
  z.object({
    action: z.literal('restart_from_step'),
    stepIndex: stepIndexSchema,
    epoch: epochSchema,
  }),
  z.object({ action: z.literal('restart_from_scratch'), epoch: epochSchema }),
  z.object({ action: z.literal('escalate'), epoch: epochSchema }),
  z.object({ action: z.literal('cancel'), epoch: epochSchema }),
]);

export const listIncidentsContract = {
  in: {
    query: z.object({
      projectId: projectIdSchema,
      orderId: z.string().trim().min(1).optional(),
      reason: z.enum(INCIDENT_REASONS).optional(),
      status: z.enum(INCIDENT_STATUSES).optional(),
    }),
  },
  out: {
    200: z.object({ code: z.literal(200), items: z.array(incidentDto) }),
  },
};

export const resolveIncidentContract = {
  in: {
    params: idParams,
    body: resolveIncidentBody,
  },
  out: {
    200: z.object({
      code: z.literal(200),
      incident: incidentDto,
      workOrder: workOrderDto,
    }),
  },
};
