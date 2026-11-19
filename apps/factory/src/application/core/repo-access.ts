import { parseRepoConfig } from '../../domain/repo-config/parse-repo-config';
import { ArgumentError, Refused } from './errors';
import type { Ports } from './procedure';

const NO_TOKEN_MESSAGE = 'No token stored, cannot run this procedure';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const readProjectId = async (
  ctx: Ports,
  configPath: string,
): Promise<string> => {
  if (!(await ctx.fs.exists(configPath))) {
    throw new ArgumentError(`no repo config at ${configPath}`);
  }
  try {
    return parseRepoConfig(await ctx.fs.readText(configPath)).project;
  } catch (error) {
    throw new ArgumentError(
      `invalid repo config ${configPath}: ${errorText(error)}`,
    );
  }
};

export const readSecret = async (ctx: Ports): Promise<string> => {
  const secret = await ctx.tokens.secret();
  if (secret === null) {
    throw new Refused(NO_TOKEN_MESSAGE);
  }
  return secret;
};
