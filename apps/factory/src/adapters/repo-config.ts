import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ArgumentError } from '../errors';
import type { RepoConfigPort } from '../ports';
import { REPO_CONFIG_PATH } from '../config';

const RepoConfigSchema = z.looseObject({
  project: z.string().trim().min(1),
  rules: z.string().optional(),
  skills: z.string().optional(),
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createRepoConfigAdapter = (): RepoConfigPort => ({
  projectIdOf: async (repoRoot) => {
    const configPath = join(repoRoot, REPO_CONFIG_PATH);
    if (!existsSync(configPath)) {
      throw new ArgumentError(
        `${REPO_CONFIG_PATH} not found in ${repoRoot}, a Cell starts only inside a project repo`,
      );
    }
    try {
      return RepoConfigSchema.parse(
        JSON.parse(readFileSync(configPath, 'utf8')),
      ).project;
    } catch (error) {
      throw new ArgumentError(
        `invalid repo config ${configPath}: ${errorText(error)}`,
      );
    }
  },
});
