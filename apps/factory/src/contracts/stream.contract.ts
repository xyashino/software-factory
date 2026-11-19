import { z } from 'zod';
import { ACTOR_KINDS, ENTITY_TYPES, projectIdSchema } from './common';

export const streamQuery = z.object({
  projectId: projectIdSchema.optional(),
  afterSeq: z.coerce.number().int().min(0).default(0),
});

export const transitionDto = z.object({
  seq: z.number().int(),
  projectId: z.string(),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string(),
  fromState: z.string().nullable(),
  toState: z.string(),
  actorKind: z.enum(ACTOR_KINDS),
  actorId: z.string().nullable(),
  commandId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  at: z.number().int(),
});
