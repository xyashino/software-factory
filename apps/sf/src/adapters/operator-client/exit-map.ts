import { z } from 'zod';
import { EXIT, type ExitCode } from '../../domain/exit-codes';
import type { OperatorReply } from '../../application/ports/operator-client.port';

const ErrorBodySchema = z.object({
  code: z.union([z.number(), z.string()]),
  message: z.string(),
});

export const exitCodeFor = (status: number): ExitCode => {
  switch (status) {
    case 200:
      return EXIT.ok;
    case 400:
    case 401:
    case 409:
    case 500:
      return EXIT.refused;
    default:
      return EXIT.unreachable;
  }
};

export const errorLineFor = (reply: OperatorReply): string | undefined => {
  const parsed = ErrorBodySchema.safeParse(reply.body);
  return parsed.success
    ? `${parsed.data.code}: ${parsed.data.message}`
    : undefined;
};
