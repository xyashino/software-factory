import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { ContractInput } from '../types';

const sampleContract = {
  in: {
    params: z.object({ id: z.string() }),
    query: z.object({ limit: z.coerce.number() }),
    body: z.object({ name: z.string(), force: z.boolean().optional() }),
  },
  out: {},
} satisfies {
  in: { params: z.ZodType; query: z.ZodType; body: z.ZodType };
  out: Record<number, z.ZodType>;
};

describe('ContractInput', () => {
  it('infers params, query and body output types from a sample contract', () => {
    const input: ContractInput<typeof sampleContract> = {
      params: { id: 'cell-1' },
      query: { limit: 10 },
      body: { name: 'cell' },
    };

    expect(sampleContract.in.body.safeParse(input.body).success).toBe(true);
    expectTypeOf(input).toEqualTypeOf<{
      params: { id: string };
      query: { limit: number };
      body: { name: string; force?: boolean | undefined };
    }>();
  });
});
