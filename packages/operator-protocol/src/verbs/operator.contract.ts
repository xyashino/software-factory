import { z } from 'zod';
import { replySchemas } from '../replies';

const token = z.string().min(16).max(256);

const verdictBody = z.discriminatedUnion('result', [
  z
    .object({ verb: z.literal('verdict'), result: z.literal('pass'), token })
    .strict(),
  z
    .object({
      verb: z.literal('verdict'),
      result: z.literal('fail'),
      feedback: z.string().min(1).max(65536),
      token,
    })
    .strict(),
]);

export const doneContract = {
  body: z.object({ verb: z.literal('done'), token }).strict(),
  replies: replySchemas,
};

export const verdictContract = {
  body: verdictBody,
  replies: replySchemas,
};

export const blockContract = {
  body: z
    .object({
      verb: z.literal('block'),
      reason: z.string().min(1).max(8192),
      handover: z.string().max(65536),
      token,
    })
    .strict(),
  replies: replySchemas,
};

export const contextContract = {
  body: z.object({ verb: z.literal('context'), token }).strict(),
  replies: replySchemas,
};
