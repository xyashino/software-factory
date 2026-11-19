import type { Context } from 'hono';
import type { Procedure } from '../../application/core/procedure';
import { BadRequest } from '../../application/core/error-handling';
import type { ContractIn } from '../../application/core/schema/types';
import type { AppEnv } from './types';

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('Malformed JSON body');
  }
};

const readJson = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (text.length === 0) return undefined;
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new BadRequest('Unsupported Content-Type, expected application/json');
  return parseJson(text);
};

export const honoAdapter = (procedure: Procedure) => {
  const declared: ContractIn = procedure.contract.in ?? {};
  return async (c: Context<AppEnv>) => {
    const response = await procedure.execute(
      {
        params: declared.params ? c.req.param() : {},
        query: declared.query ? c.req.query() : {},
        body: declared.body ? await readJson(c.req.raw) : undefined,
      },
      c.get('transport'),
    );
    return c.json(response, response.code);
  };
};
