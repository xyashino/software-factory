import { upsertProjectContract } from '@repo/hq-contracts/projects.contract';
import { asProjectId } from '../../../domain/common/brand';
import { scopedProcedure } from '../../core/procedure';
import { findProject } from '../../orders/order-writes';

export const upsertProjectProcedure = scopedProcedure(['supervisor:write'])(
  upsertProjectContract,
)((input, ctx) => {
  const { projectId, repoUrl, defaultBaseBranch, maxRunning } = input.body;
  const now = ctx.clock.now();

  return ctx.storage.write((tx) => {
    if (findProject(tx, projectId) === undefined) {
      const project = tx.projects.insert({
        projectId: asProjectId(projectId),
        repoUrl,
        defaultBaseBranch,
        maxRunning,
        createdAt: now,
        updatedAt: now,
      });
      return { code: 201 as const, project };
    }
    const project = tx.projects.update(asProjectId(projectId), {
      repoUrl,
      defaultBaseBranch,
      maxRunning,
      updatedAt: now,
    });
    return { code: 200 as const, project };
  });
});
