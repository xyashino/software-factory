import type { Context } from 'hono';
import type { Procedure } from '../../application/core/procedure';
import { BadRequest } from '../../application/core/error-handling';
import type { AppEnv } from './types';

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('Malformed JSON body');
  }
};

const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text.length === 0 ? undefined : parseJson(text);
};

export const honoAdapter =
  (procedure: Procedure) => async (c: Context<AppEnv>) => {
    const response = await procedure(
      {
        params: c.req.param(),
        query: c.req.query(),
        body: await readBody(c.req.raw),
      },
      c.get('transport'),
    );
    return c.json(response, response.code);
  };
