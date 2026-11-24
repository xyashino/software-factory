import { z } from 'zod';
import type { QueueImportReply } from './ports';

const OK = 200;
const INVALID = 422;

const CountsSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});

const InvalidSchema = z.object({
  errors: z.array(z.object({ filename: z.string(), message: z.string() })),
});

export const queueReplyOf = async (
  response: Response,
): Promise<QueueImportReply> => {
  if (response.status === OK) {
    return { kind: 'ok', value: CountsSchema.parse(await response.json()) };
  }
  if (response.status === INVALID) {
    const { errors } = InvalidSchema.parse(await response.json());
    return { kind: 'invalid', errors };
  }
  throw new Error(`queue import failed with ${response.status}`);
};
