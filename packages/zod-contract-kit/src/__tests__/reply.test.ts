import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorResponse, parseReply } from '../reply';
import type { ZodContract } from '../types';

const contract = {
  out: {
    200: z.object({ code: z.literal(200), id: z.string() }),
    404: errorResponse(404, 'not_found'),
  },
} satisfies ZodContract;

describe('parseReply', () => {
  it('returns the value when the body matches the declared status', () => {
    const json = { code: 200, id: 'cell-1' };

    const outcome = parseReply(contract, 200, json);

    expect(outcome).toEqual({ ok: true, value: json });
  });

  it('reports an undeclared status when the contract has no schema for it', () => {
    const outcome = parseReply(contract, 500, { code: 500 });

    expect(outcome).toEqual({
      ok: false,
      reason: 'undeclared-status',
      status: 500,
    });
  });

  it('reports the invalid body with issues when it does not match the schema', () => {
    const outcome = parseReply(contract, 404, {
      code: 404,
      type: 'not_found',
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: 'invalid-body',
      status: 404,
      issues: [expect.objectContaining({ path: ['message'] })],
    });
  });

  it('never throws for a non-object body', () => {
    const outcome = parseReply(contract, 200, 'not json');

    expect(outcome.ok).toBe(false);
  });
});

describe('errorResponse', () => {
  it('accepts the declared code and type with a message', () => {
    const schema = errorResponse(409, 'conflict');

    const result = schema.safeParse({
      code: 409,
      type: 'conflict',
      message: 'already exists',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a body whose code differs from the declared code', () => {
    const schema = errorResponse(409, 'conflict');

    const result = schema.safeParse({
      code: 400,
      type: 'conflict',
      message: 'already exists',
    });

    expect(result.success).toBe(false);
  });
});
