import type { z } from 'zod';
import type { HttpStatus } from './http-status';

export type ContractIn = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

export type ZodContract = {
  in?: ContractIn;
  out: Record<number, z.ZodType>;
};

export type ProcedureResponse = { code: HttpStatus };

export type RawInput = {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
};

type InputPart<T> = T extends z.ZodType ? z.output<T> : undefined;

type PartOf<C, K extends keyof ContractIn> = C extends { in: infer I }
  ? I extends { [P in K]: infer S }
    ? InputPart<S>
    : undefined
  : undefined;

export type ContractInput<C extends ZodContract> = {
  params: PartOf<C, 'params'>;
  query: PartOf<C, 'query'>;
  body: PartOf<C, 'body'>;
};
