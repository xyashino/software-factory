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
const SUPERVISOR: Access = { kind: 'supervisor' };

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

export const settle = async <O>(
  attempt: () => Promise<O>,
): Promise<RunResult<O>> => {
  try {
    return { kind: 'ok', value: await attempt() };
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

export const run = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  mode: Mode,
  build: Build = buildContext,
): Promise<RunResult<O>> =>
  settle(async () => {
    const ports = build(mode);
    const token = await ports.tokens.read();
    if (token === null) {
      throw new Refused(NO_TOKEN_MESSAGE);
    }
    const ctx: Context<Access> = { ...ports, token, principal: token };
    return procedure.execute(input, ctx);
  });

export const runWithoutToken = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  ports: Ports,
): Promise<RunResult<O>> =>
  settle(() =>
    procedure.execute(input, {
      ...ports,
      token: SUPERVISOR,
      principal: SUPERVISOR,
    }),
  );
