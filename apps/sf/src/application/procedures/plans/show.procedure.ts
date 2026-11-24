import { z } from 'zod';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';
import { type OrderPlan, fetchPlans, planBySlug } from './lookup';

const ShowSchema = z
  .object({ configPath: z.string().min(1), slug: z.string().trim().min(1) })
  .strict();

export const showPlan = define({ kind: 'supervisor' })(ShowSchema)<OrderPlan>(
  async (input, ctx) => {
    const projectId = await readProjectId(ctx, input.configPath);
    const secret = await readSecret(ctx);
    return planBySlug(await fetchPlans(ctx, projectId, secret), input.slug);
  },
);
