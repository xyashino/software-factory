import { eq } from 'drizzle-orm';
import { immediateTx } from '../../../db/client';
import { projects } from '../../../db/schema/projects';
import { upsertProjectContract } from '../../../contracts/projects.contract';
import { asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { findProject } from '../../orders/order-writes';

export const upsertProjectProcedure = scopedProcedure(['supervisor:write'])(
  upsertProjectContract,
)((input, ctx) => {
  const { projectId, repoUrl, defaultBaseBranch, maxRunning } = input.body;
  const now = ctx.clock.now();

  return immediateTx(ctx.db, (tx) => {
    if (findProject(tx, projectId) === undefined) {
      const project = tx
        .insert(projects)
        .values({
          projectId: asProjectId(projectId),
          repoUrl,
          defaultBaseBranch,
          maxRunning,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return { code: 201 as const, project };
    }
    const project = tx
      .update(projects)
      .set({ repoUrl, defaultBaseBranch, maxRunning, updatedAt: now })
      .where(eq(projects.projectId, asProjectId(projectId)))
      .returning()
      .get();
    return { code: 200 as const, project };
  });
});
