import { buildContext } from '../../bootstrap/context';
import { type RunResult, runWithoutToken } from '../../bootstrap/run';
import type { Procedure } from '../../application/core/procedure';
import { DEFAULT_CELL_SERVER_URL } from '../../config';

export const cellServerEndpoint = (): { host: string; port: number } => {
  const url = new URL(process.env.CELL_SERVER_URL ?? DEFAULT_CELL_SERVER_URL);
  return { host: url.hostname, port: Number(url.port || 80) };
};

export const runCellServer = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
): Promise<RunResult<O>> => runWithoutToken(procedure, input, buildContext());
