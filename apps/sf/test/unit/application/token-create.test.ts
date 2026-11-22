import { describe, expect, it } from 'vitest';
import { Refused } from '../../../src/application/core/errors';
import { createToken } from '../../../src/application/procedures/tokens/token-create.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const JOIN_TOKEN = 'sf_join_0123456789abcdef';

const ISSUED = {
  code: 201,
  tokenId: 'tok_1',
  kind: 'cell_join',
  token: JOIN_TOKEN,
  scopes: ['cell:join'],
  expiresAt: null,
};

describe('token create', () => {
  it('returns the join token the server issues', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ISSUED });

    // Act
    const result = await runProcedure(
      createToken,
      { kind: 'cell_join', name: 'worker-1' },
      fake,
    );

    // Assert
    expect(result.token).toBe(JOIN_TOKEN);
    expect(fake.calls).toEqual([
      {
        method: 'POST',
        route: '/api/v1/tokens',
        body: { kind: 'cell_join', name: 'worker-1', expiresAt: null },
        token: 'secret-value',
      },
    ]);
  });

  it('refuses a token name that spans several lines', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ISSUED });

    // Act
    const attempt = runProcedure(
      createToken,
      { kind: 'cell_join', name: 'worker\n1' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('refuses to mint a token without a stored supervisor token', async () => {
    // Arrange
    const fake = createFakePorts({ secret: null, reply: () => ISSUED });

    // Act
    const attempt = runProcedure(
      createToken,
      { kind: 'cell_join', name: 'worker-1' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toThrow(Refused);
    expect(fake.calls).toEqual([]);
  });
});
