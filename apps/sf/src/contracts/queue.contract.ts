import { z } from 'zod';
import {
  PRIORITIES,
  WORK_ORDER_STATES,
  errorReplies,
  projectIdSchema,
  slugSchema,
} from './common';

const importErrorDto = z.object({
  filename: z.string(),
  message: z.string(),
});

const exportFileDto = z.object({
  filename: z.string(),
  slug: z.string(),
  orderId: z.string(),
  projectId: z.string(),
  line: z.string(),
  planSlug: z.string().nullable(),
  state: z.enum(WORK_ORDER_STATES),
  priority: z.enum(PRIORITIES),
  markdown: z.string(),
});

const orderIdsSchema = z.array(z.string().trim().min(1)).min(1).max(200);

const statesQuerySchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((state) => state.trim())
      .filter((state) => state.length > 0),
  )
  .pipe(z.array(z.enum(WORK_ORDER_STATES)));

export const exportQueueContract = {
  in: {
    query: z.object({
      projectId: projectIdSchema,
      planSlug: slugSchema.optional(),
      states: statesQuerySchema.optional(),
    }),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      projectId: z.string(),
      exportedAt: z.number().int(),
      files: z.array(exportFileDto),
    }),
    ...errorReplies,
  },
};

export const importQueueContract = {
  in: {
    body: z
      .object({
        commandId: z.string().trim().min(1).optional(),
        projectId: projectIdSchema,
        mode: z.enum(['dry_run', 'apply']),
        files: z
          .array(
            z.object({ filename: z.string().min(1), markdown: z.string() }),
          )
          .max(500),
      })
      .strict()
      .refine(
        (body) => body.mode === 'dry_run' || body.commandId !== undefined,
        {
          message: 'commandId is required when mode is apply',
          path: ['commandId'],
        },
      ),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      mode: z.enum(['dry_run', 'apply']),
      created: z.number().int(),
      updated: z.number().int(),
      skipped: z.number().int(),
      errors: z.array(importErrorDto),
    }),
    422: z.object({
      code: z.literal(422),
      type: z.literal('unprocessable-entity'),
      message: z.string(),
      errors: z.array(importErrorDto).min(1),
    }),
    ...errorReplies,
  },
};

export const queueActionsContract = {
  in: {
    body: z.discriminatedUnion('action', [
      z
        .object({ action: z.literal('pause'), orderIds: orderIdsSchema })
        .strict(),
      z
        .object({ action: z.literal('unpause'), orderIds: orderIdsSchema })
        .strict(),
      z
        .object({
          action: z.literal('reset_to_scratch'),
          orderIds: orderIdsSchema,
        })
        .strict(),
      z
        .object({ action: z.literal('cancel'), orderIds: orderIdsSchema })
        .strict(),
      z
        .object({
          action: z.literal('reprioritise'),
          orderIds: orderIdsSchema,
          priority: z.enum(PRIORITIES),
        })
        .strict(),
    ]),
  },
  out: {
    200: z.object({
      code: z.literal(200),
      orders: z.array(
        z.object({
          orderId: z.string(),
          state: z.enum(WORK_ORDER_STATES),
          priority: z.enum(PRIORITIES),
        }),
      ),
    }),
    ...errorReplies,
  },
};
