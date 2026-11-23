import type { z } from 'zod';
import type {
  ContractIn,
  ContractInput,
  ProcedureResponse,
  RawInput,
  ZodContract,
} from '@repo/zod-contract-kit/types';
import { BadRequest, InternalServer } from '../error-handling';

type Section = keyof ContractIn;

const toBadRequest = (section: Section, error: z.ZodError): BadRequest => {
  const issue = error.issues[0];
  const path = [section, ...(issue?.path ?? []).map(String)].join('.');
  return new BadRequest(
    `Invalid request payload: ${path}: ${issue?.message ?? 'invalid value'}`,
  );
};

const parseSection = (
  contract: ZodContract,
  section: Section,
  value: unknown,
): unknown => {
  const schema = contract.in?.[section];
  if (schema === undefined) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw toBadRequest(section, result.error);
  return result.data;
};

const parseOutput = <R extends ProcedureResponse>(
  contract: ZodContract,
  output: R,
): R => {
  const schema = contract.out[output.code];
  if (schema === undefined)
    throw new InternalServer(`Undeclared response code ${output.code}`);
  if (!schema.safeParse(output).success)
    throw new InternalServer(`Response does not match contract ${output.code}`);
  return output;
};

export const withZodSchema =
  <C extends ZodContract>(contract: C) =>
  <Ctx, R extends ProcedureResponse>(
    handler: (input: ContractInput<C>, ctx: Ctx) => R | Promise<R>,
  ) =>
  async (raw: RawInput, ctx: Ctx): Promise<R> => {
    const input = {
      params: parseSection(contract, 'params', raw.params),
      query: parseSection(contract, 'query', raw.query),
      body: parseSection(contract, 'body', raw.body),
    } as ContractInput<C>;
    return parseOutput(contract, await handler(input, ctx));
  };
