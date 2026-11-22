import type { Access } from '../../domain/access';
import type { Connection } from '../../domain/connection/connection-config';
import type { ConnectionStorePort } from '../ports/connection-store.port';
import type { ClockPort } from '../ports/clock.port';
import type { FactoryCredentialPort } from '../ports/factory-credential.port';
import type { FactoryDaemonPort } from '../ports/factory-daemon.port';
import type { FsPort } from '../ports/fs.port';
import type { HqClientPort } from '../ports/hq-client.port';
import type { GitPort } from '../ports/git.port';
import type { OperatorEndpointPort } from '../ports/operator-endpoint.port';
import type { PidFilePort } from '../ports/pid-file.port';
import type { PrPort } from '../ports/pr.port';
import type { ProcessPort } from '../ports/process.port';
import type { RunnerCatalogPort } from '../ports/runner-catalog.port';
import type { RunnerPort } from '../ports/runner.port';
import type { ServerPort } from '../ports/server.port';
import type { TodoFilesPort } from '../ports/todo-files.port';
import type { TokenStorePort } from '../ports/token-store.port';
import { ArgumentError, Refused } from './errors';

const REFUSAL_MESSAGE = 'Token cannot run this procedure';

export interface Ports {
  server: ServerPort;
  connection: Connection;
  connections: ConnectionStorePort;
  fs: FsPort;
  todoFiles: TodoFilesPort;
  tokens: TokenStorePort;
  operator: OperatorEndpointPort;
  runner: RunnerPort;
  runners: RunnerCatalogPort;
  git: GitPort;
  pr: PrPort;
  process: ProcessPort;
  pidFile: PidFilePort;
  webPidFile: PidFilePort;
  clock: ClockPort;
  factoryDaemon: FactoryDaemonPort;
  factoryPidFile: PidFilePort;
  factoryCredential: FactoryCredentialPort;
  hq: HqClientPort;
}

export type Context<A extends Access> = Ports & {
  token: Access;
  principal: A;
};

export interface Schema<I> {
  parse(raw: unknown): I;
}

export interface Procedure<I, O> {
  access: Access;
  parse: (raw: unknown) => I;
  execute: (raw: unknown, ctx: Context<Access>) => Promise<O>;
}

const isAllowed = (access: Access, token: Access): boolean => {
  switch (access.kind) {
    case 'supervisor':
      return token.kind === 'supervisor';
    case 'cell':
      return token.kind === 'cell' && token.cellId === access.cellId;
    case 'job':
      return (
        token.kind === 'job' &&
        token.jobId === access.jobId &&
        token.role === access.role &&
        token.epoch === access.epoch
      );
  }
};

const authorize = (access: Access, token: Access): void => {
  if (!isAllowed(access, token)) {
    throw new Refused(REFUSAL_MESSAGE);
  }
};

const checkAccess = <A extends Access>(
  access: A,
  ctx: Context<Access>,
): Context<A> => {
  authorize(access, ctx.token);
  return { ...ctx, principal: ctx.token as A };
};

const parseWith = <I>(schema: Schema<I>, raw: unknown): I => {
  try {
    return schema.parse(raw);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : 'invalid argument',
    );
  }
};

export const define =
  <A extends Access>(access: A) =>
  <I>(schema: Schema<I>) =>
  <O>(handler: (input: I, ctx: Context<A>) => Promise<O>): Procedure<I, O> => ({
    access,
    parse: (raw) => parseWith(schema, raw),
    execute: async (raw, ctx) => {
      const scoped = checkAccess(access, ctx);
      const input = parseWith(schema, raw);
      return handler(input, scoped);
    },
  });
