import { describe, expect, it } from 'vitest';
import {
  blobRefSchema,
  commitShaSchema,
  cycleIdSchema,
  orderIdOf,
  orderIdSchema,
  parseOrderId,
  projectIdSchema,
  todoIdSchema,
} from '../ids';

const ULID = '01HZX3K9Q4M7N2P8R6T1V5W0YA';

describe('identifiers', () => {
  it('accepts a slug as a project id', () => {
    expect(projectIdSchema.safeParse('software-factory').success).toBe(true);
  });

  it('rejects an uppercase project id', () => {
    expect(projectIdSchema.safeParse('Software').success).toBe(false);
  });

  it('forms an order id from a project and a todo', () => {
    const orderId = orderIdOf(
      projectIdSchema.parse('software-factory'),
      todoIdSchema.parse('v2-02-core'),
    );
    expect(orderId).toBe('software-factory:v2-02-core');
  });

  it('splits an order id back into its project and todo', () => {
    expect(parseOrderId('software-factory:v2-02-core')).toEqual({
      projectId: 'software-factory',
      todoId: 'v2-02-core',
    });
  });

  it('returns no parts for text that is not an order id', () => {
    expect(parseOrderId('no-colon-here')).toBeUndefined();
  });

  it('rejects an order id that names no todo', () => {
    expect(orderIdSchema.safeParse('software-factory:').success).toBe(false);
  });

  it('accepts a ULID as a cycle id', () => {
    expect(cycleIdSchema.safeParse(ULID).success).toBe(true);
  });

  it('rejects a cycle id with a letter the ULID alphabet leaves out', () => {
    expect(cycleIdSchema.safeParse('01HZX3K9Q4M7N2P8R6T1V5W0YI').success).toBe(
      false,
    );
  });

  it('accepts a sha256 blob ref', () => {
    expect(blobRefSchema.safeParse(`sha256:${'a'.repeat(64)}`).success).toBe(
      true,
    );
  });

  it('rejects a blob ref without the sha256 prefix', () => {
    expect(blobRefSchema.safeParse('a'.repeat(64)).success).toBe(false);
  });

  it('accepts a forty-hex commit sha', () => {
    expect(
      commitShaSchema.safeParse('0123456789abcdef0123456789abcdef01234567')
        .success,
    ).toBe(true);
  });

  it('rejects a commit sha that is too short', () => {
    expect(commitShaSchema.safeParse('0123abc').success).toBe(false);
  });
});
