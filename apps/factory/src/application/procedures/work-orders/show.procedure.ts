import { z } from 'zod';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const WORK_ORDERS_ROUTE = '/api/v1/work-orders';

const ShowSchema = z.object({ orderId: z.string().trim().min(1) }).strict();

const ShowReplySchema = z.looseObject({
  order: z.looseObject({
    orderId: z.string(),
    lineName: z.string(),
    state: z.string(),
    priority: z.string(),
  }),
  steps: z.array(
    z.looseObject({
      stepIndex: z.number(),
      stationId: z.string(),
      kind: z.string(),
      state: z.string(),
    }),
  ),
  jobs: z.array(
    z.looseObject({
      jobId: z.string(),
      kind: z.string(),
      status: z.string(),
      cellId: z.string().nullable(),
    }),
  ),
  incidents: z.array(
    z.looseObject({
      incidentId: z.string(),
      reason: z.string(),
      status: z.string(),
    }),
  ),
});

export type WorkOrderDetail = z.infer<typeof ShowReplySchema>;

export const showWorkOrder = define({ kind: 'supervisor' })(
  ShowSchema,
)<WorkOrderDetail>(async (input, ctx) => {
  const secret = await readSecret(ctx);
  return ShowReplySchema.parse(
    await ctx.server.get(
      `${WORK_ORDERS_ROUTE}/${encodeURIComponent(input.orderId)}`,
      {},
      secret,
    ),
  );
});
