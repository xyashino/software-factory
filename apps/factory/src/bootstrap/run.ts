import {
  ArgumentError,
  Refused,
  Unauthorized,
  Unreachable,
} from '../application/core/errors';
import type { Context, Ports, Procedure } from '../application/core/procedure';
import type { Access } from '../domain/access';
import type { Connection } from '../domain/connection/connection-config';
import { recoveryCommandOf } from '../domain/connection/connection-config';
import { EXIT, type ExitCode } from '../domain/exit-codes';
import { buildContext, type Mode } from './context';

const SUPERVISOR: Access = { kind: 'supervisor' };

const noTokenMessage = (connection: Connection): string =>
  `No token stored for ${connection.url}, cannot run this procedure\nfix: ${recoveryCommandOf(connection.url)}`;

const unauthorizedMessage = (connection: Connection, reason: string): string =>
  [
    reason,
    `target: ${connection.url} (${connection.urlSource})`,
    `token source: ${connection.tokenSource ?? 'none'}`,
    `fix: ${recoveryCommandOf(connection.url)}`,
  ].join('\n');

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
  build: Build = () => buildContext(),
): Promise<RunResult<O>> =>
  settle(async () => {
    const ports = build(mode);
    const token = await ports.tokens.read();
    if (token === null) {
      throw new Refused(noTokenMessage(ports.connection));
    }
    const ctx: Context<Access> = { ...ports, token, principal: token };
    try {
      return await procedure.execute(input, ctx);
    } catch (error) {
      if (error instanceof Unauthorized) {
        throw new Refused(
          unauthorizedMessage(ports.connection, error.message),
          error.details,
        );
      }
      throw error;
    }
  });

export const runWithoutToken = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  ports: Ports | (() => Ports),
): Promise<RunResult<O>> =>
  settle(async () =>
    procedure.execute(input, {
      ...(typeof ports === 'function' ? ports() : ports),
      token: SUPERVISOR,
      principal: SUPERVISOR,
    }),
  );
