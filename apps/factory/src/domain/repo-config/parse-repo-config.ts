import { z } from 'zod';

const RepoConfigSchema = z.looseObject({
  project: z.string().trim().min(1),
  rules: z.string().optional(),
  skills: z.string().optional(),
});

export interface RepoConfig {
  project: string;
  rules?: string;
  skills?: string;
}

export const parseRepoConfig = (text: string): RepoConfig =>
  RepoConfigSchema.parse(JSON.parse(text));
