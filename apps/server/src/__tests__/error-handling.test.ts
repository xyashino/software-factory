import { describe, expect, it } from 'vitest';
import { RefusalError, toWireError } from '../application/core/error-handling';
import { RuntimeError } from '@repo/factory-runtime/errors';

describe('error mapping', () => {
  it('keeps the wire body of a refusal', () => {
    const error = new RefusalError({ code: 'unauthorized' });

    expect(toWireError(error)).toEqual({ code: 'unauthorized' });
  });

  it('keeps the wire body of a runtime refusal', () => {
    const error = new RuntimeError({ code: 'not_found' });

    expect(toWireError(error)).toEqual({ code: 'not_found' });
  });

  it('turns a validation failure into invalid, listing each issue', () => {
    const error = Object.assign(new Error('bad input'), {
      issues: [{ path: ['orderId'], message: 'Required' }],
    });

    expect(toWireError(error)).toEqual({
      code: 'invalid',
      issues: ['orderId: Required'],
    });
  });

  it('answers any other failure as unavailable', () => {
    expect(toWireError(new Error('disk on fire'))).toEqual({
      code: 'unavailable',
    });
  });
});
