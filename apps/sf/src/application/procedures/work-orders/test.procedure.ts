import { z } from 'zod';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';

const WORK_ORDERS_ROUTE = '/api/v1/work-orders';
const SMOKE_TITLE = 'Smoke test runner and PR delivery';
const SMOKE_DESCRIPTION =
  'Smoke test of the Cell pipeline. Do not change application code. Add only the required decisions/ entry, write the report and commit message files, then run sf operator done.';

const CreateSchema = z
  .object({
    configPath: z.string().min(1),
    lineName: z.string().trim().min(1).default('fast'),
    slug: z.string().trim().min(1).optional(),
  })
  .strict();

const CreatedReplySchema = z.looseObject({
  order: z.looseObject({
    orderId: z.string(),
    slug: z.string(),
    state: z.string(),
    lineName: z.string(),
    priority: z.string(),
  }),
});

export interface TestOrderResult {
  order: {
    orderId: string;
    slug: string;
    state: string;
    lineName: string;
    priority: string;
  };
}

const smokeSlugOf = (epochMs: number): string =>
  `smoke-test-${Math.floor(epochMs / 1000)}`;

export const createTestWorkOrder = define({ kind: 'supervisor' })(
  CreateSchema,
)<TestOrderResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  const reply = CreatedReplySchema.parse(
    await ctx.hq.call(
      WORK_ORDERS_ROUTE,
      {
        projectId,
        slug: input.slug ?? smokeSlugOf(ctx.clock.now()),
        title: SMOKE_TITLE,
        type: 'chore',
        description: SMOKE_DESCRIPTION,
        lineName: input.lineName,
        priority: 'high',
      },
      secret,
    ),
  );
  const { orderId, slug, state, lineName, priority } = reply.order;
  return { order: { orderId, slug, state, lineName, priority } };
});
