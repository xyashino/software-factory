import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pageOut, paginationIn } from '../fields';

describe('paginationIn', () => {
  it('applies the default limit when the query omits it', () => {
    const result = paginationIn.parse({});

    expect(result).toEqual({ limit: 20 });
  });

  it('coerces a numeric string limit and keeps the cursor', () => {
    const result = paginationIn.parse({ limit: '50', cursor: 'abc' });

    expect(result).toEqual({ limit: 50, cursor: 'abc' });
  });

  it('rejects a limit above the maximum', () => {
    const result = paginationIn.safeParse({ limit: '101' });

    expect(result.success).toBe(false);
  });
});

describe('pageOut', () => {
  it('wraps the items in a 200 page with a nullable next cursor', () => {
    const schema = pageOut(z.object({ id: z.string() }));

    const result = schema.parse({
      code: 200,
      items: [{ id: 'a' }],
      nextCursor: null,
    });

    expect(result).toEqual({
      code: 200,
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });

  it('rejects an item that does not match the item schema', () => {
    const schema = pageOut(z.object({ id: z.string() }));

    const result = schema.safeParse({
      code: 200,
      items: [{ id: 1 }],
      nextCursor: null,
    });

    expect(result.success).toBe(false);
  });
});
