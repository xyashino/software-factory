import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../../../src/application/core/errors';
import { resolveCellTarget } from '../../../../../src/application/procedures/cell/resolve-project-target';
import { createFakePorts } from '../../../../support/fake-ports';

describe('cell target of a repo', () => {
  it('takes the project named by the repo config', async () => {
    // Arrange
    const { ports } = createFakePorts({
      config: JSON.stringify({ project: 'alpha' }),
    });

    // Act
    const target = await resolveCellTarget(ports, '/repos/alpha');

    // Assert
    expect(target).toEqual({ projectId: 'alpha', repoRoot: '/repos/alpha' });
  });

  it('refuses a repo without a repo config', async () => {
    // Arrange
    const { ports } = createFakePorts({ config: null });

    // Act
    const pick = resolveCellTarget(ports, '/repos/bare');

    // Assert
    await expect(pick).rejects.toBeInstanceOf(ArgumentError);
    await expect(pick).rejects.toThrow(
      'a Cell starts only inside a project repo',
    );
  });
});
