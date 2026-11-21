import {
  LOCAL_TARGET,
  withTarget,
} from '../../../domain/connection/connection-config';
import { Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';

export interface MintInput {
  bin: string;
  serverArgs: readonly string[];
  cwd: string;
  dbPath: string;
}

export const mintSupervisorToken = async (
  ctx: Ports,
  input: MintInput,
): Promise<string> => {
  const result = await ctx.process.run(
    input.bin,
    [...input.serverArgs, 'admin', 'token', 'create'],
    input.cwd,
    { FACTORY_DB_PATH: input.dbPath },
  );
  const token = result.stdout.trim();
  if (result.exitCode !== 0 || token.length === 0) {
    throw new Refused(`token create failed with exit ${result.exitCode}`);
  }
  return token;
};

export const saveLocalTarget = (
  ctx: Ports,
  url: string,
  token: string,
): void => {
  const config = ctx.connections.read();
  ctx.connections.write(
    withTarget(config, LOCAL_TARGET, { url, token }, config.current === null),
  );
};
