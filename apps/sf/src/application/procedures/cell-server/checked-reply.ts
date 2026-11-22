import type { z } from 'zod';
import { parseReply, type ReplyOutcome } from '@repo/zod-contract-kit/reply';
import type { ZodContract } from '@repo/zod-contract-kit/types';
import { Unreachable } from '../../core/errors';

const REPLY_STATUS = 200;

const describeFailure = (
  outcome: Exclude<ReplyOutcome, { ok: true }>,
): string => {
  if (outcome.reason === 'undeclared-status') {
    return `status ${outcome.status} is not declared`;
  }
  return outcome.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
};

export const checkedReply = <S extends z.ZodType>(
  route: string,
  contract: ZodContract,
  shape: S,
  json: unknown,
): z.output<S> => {
  const outcome = parseReply(contract, REPLY_STATUS, json);
  if (!outcome.ok) {
    throw new Unreachable(
      `cell server reply from ${route} does not match its contract: ${describeFailure(outcome)}`,
    );
  }
  return shape.parse(outcome.value);
};
