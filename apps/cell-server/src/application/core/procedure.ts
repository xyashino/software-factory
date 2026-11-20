import type { Db } from '../../db/client';
import type { ClockPort } from '../ports/clock.port';
import type { EventBusPort } from '../ports/event-bus.port';
import { withZodSchema } from './schema/zod';
import type {
  ContractInput,
  ProcedureResponse,
  RawInput,
  ZodContract,
} from './schema/types';

export type TransportContext = {
  db: Db;
  clock: ClockPort;
  eventBus: EventBusPort;
  signal: AbortSignal;
  remoteAddress: string | null;
};

export type Procedure = {
  readonly contract: ZodContract;
  execute(raw: RawInput, ctx: TransportContext): Promise<ProcedureResponse>;
};

export const publicProcedure =
  <C extends ZodContract>(contract: C) =>
  <R extends ProcedureResponse>(
    handler: (input: ContractInput<C>, ctx: TransportContext) => R | Promise<R>,
  ): Procedure => ({
    contract,
    execute: withZodSchema(contract)(handler),
  });
