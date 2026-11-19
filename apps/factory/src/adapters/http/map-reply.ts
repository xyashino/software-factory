import { z } from 'zod';
import { Refused, Unreachable } from '../../application/core/errors';

const SUCCESS_STATUSES: readonly number[] = [200, 201];

const ErrorBodySchema = z.object({
  code: z.union([z.number(), z.string()]),
  message: z.string(),
});

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreachable('server reply is not readable');
  }
};

export const mapReply = (status: number, text: string): unknown => {
  const body = parseBody(text);
  if (SUCCESS_STATUSES.includes(status)) {
    return body;
  }
  const error = ErrorBodySchema.safeParse(body);
  if (error.success) {
    throw new Refused(`${error.data.code}: ${error.data.message}`, body);
  }
  throw new Refused(`HTTP ${status}`);
};
