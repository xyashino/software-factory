import { describe, expect, it } from 'vitest';
import { errorReplies } from '../../../src/contracts/common';

describe('common error replies', () => {
  it('accepts a 409 reply with a known conflict type', () => {
    // Arrange
    const reply = {
      code: 409,
      type: 'stale_epoch',
      message: 'job epoch is old',
    };

    // Act
    const result = errorReplies[409].safeParse(reply);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a 409 reply with an unknown conflict type', () => {
    // Arrange
    const reply = { code: 409, type: 'busy', message: 'nope' };

    // Act
    const result = errorReplies[409].safeParse(reply);

    // Assert
    expect(result.success).toBe(false);
  });

  it('rejects a 400 reply whose code is not 400', () => {
    // Arrange
    const reply = { code: 401, type: 'invalid', message: 'bad' };

    // Act
    const result = errorReplies[400].safeParse(reply);

    // Assert
    expect(result.success).toBe(false);
  });
});
