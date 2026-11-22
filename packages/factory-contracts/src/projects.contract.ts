import { z } from 'zod';
import { projectIdSchema } from './common';

const projectDto = z.object({
  projectId: z.string(),
  repoUrl: z.string(),
  defaultBaseBranch: z.string(),
  maxRunning: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const upsertProjectContract = {
  in: {
    body: z.object({
      projectId: projectIdSchema,
      repoUrl: z.string().trim().min(1),
      defaultBaseBranch: z.string().trim().min(1),
      maxRunning: z.number().int().min(1).default(5),
    }),
  },
  out: {
    200: z.object({ code: z.literal(200), project: projectDto }),
    201: z.object({ code: z.literal(201), project: projectDto }),
  },
};

export const listProjectsContract = {
  out: {
    200: z.object({ code: z.literal(200), projects: z.array(projectDto) }),
  },
};
