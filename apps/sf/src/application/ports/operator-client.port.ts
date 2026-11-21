import type { z } from 'zod';
import type { operatorRequest } from '../../contracts/operator.contract';

type OperatorVerb = z.infer<typeof operatorRequest>;
type WithoutToken<T> = T extends unknown ? Omit<T, 'token'> : never;

export type OperatorVerbFields = WithoutToken<OperatorVerb>;

export interface OperatorReply {
  status: number;
  body: unknown;
}

export interface OperatorClientPort {
  send(verb: OperatorVerbFields): Promise<OperatorReply>;
}
