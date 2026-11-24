import { execFileSync } from 'node:child_process';
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

const originOf = (repoRoot: string): string => {
  try {
    const origin = execFileSync(
      'git',
      ['-C', repoRoot, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return origin === '' ? repoRoot : origin;
  } catch {
    return repoRoot;
  }
};

export const createRepoConfigAdapter = (): RepoConfigPort => ({
  repoUrlOf: async (repoRoot) => originOf(repoRoot),
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
