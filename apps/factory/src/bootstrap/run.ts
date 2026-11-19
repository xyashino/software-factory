import {
  ArgumentError,
  Refused,
  Unreachable,
} from '../application/core/errors';
import type { Context, Ports, Procedure } from '../application/core/procedure';
import type { Access } from '../domain/access';
import { EXIT, type ExitCode } from '../domain/exit-codes';
import { buildContext, type Mode } from './context';

const NO_TOKEN_MESSAGE = 'No token stored, cannot run this procedure';

export type RunResult<O> =
  | { kind: 'ok'; value: O }
  | { kind: 'failed'; exitCode: ExitCode; message: string };

type Build = (mode: Mode) => Ports;

const exitCodeOf = (error: unknown): ExitCode | undefined => {
  if (error instanceof Refused) {
    return EXIT.refused;
  }
  if (error instanceof ArgumentError) {
    return EXIT.argument;
  }
  if (error instanceof Unreachable) {
    return EXIT.unreachable;
  }
  return undefined;
};

export const run = async <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  mode: Mode,
  build: Build = buildContext,
): Promise<RunResult<O>> => {
  try {
    const ports = build(mode);
    const token = await ports.tokens.read();
    if (token === null) {
      throw new Refused(NO_TOKEN_MESSAGE);
    }
    const ctx: Context<Access> = { ...ports, token, principal: token };
    return { kind: 'ok', value: await procedure.execute(input, ctx) };
  } catch (error) {
    const exitCode = exitCodeOf(error);
    if (exitCode === undefined) {
      throw error;
    }
    return {
      kind: 'failed',
      exitCode,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
