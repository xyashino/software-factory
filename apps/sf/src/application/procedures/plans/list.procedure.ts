import { z } from 'zod';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';
import { type OrderPlan, fetchPlans } from './lookup';

const ListSchema = z.object({ configPath: z.string().min(1) }).strict();

export interface PlanListResult {
  projectId: string;
  rows: OrderPlan[];
}

export const listPlans = define({ kind: 'supervisor' })(
  ListSchema,
)<PlanListResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  return { projectId, rows: await fetchPlans(ctx, projectId, secret) };
});
