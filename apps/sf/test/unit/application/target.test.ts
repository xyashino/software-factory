import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import {
  listTargets,
  removeTarget,
  useTarget,
} from '../../../src/application/procedures/connection/target.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const TWO_TARGETS = {
  current: 'local',
  targets: {
    local: { url: 'http://127.0.0.1:7070', token: 'sup_local' },
    remote: { url: 'https://factory.example', token: 'sup_remote' },
  },
};

describe('target ls', () => {
  it('lists every saved target and marks the active one, without tokens', async () => {
    // Arrange
    const fake = createFakePorts({ connectionConfig: TWO_TARGETS });

    // Act
    const result = await runProcedure(listTargets, {}, fake);

    // Assert
    expect(result).toEqual({
      targets: [
        { name: 'local', url: 'http://127.0.0.1:7070', active: true },
        { name: 'remote', url: 'https://factory.example', active: false },
      ],
    });
  });
});

describe('target use', () => {
  it('makes the named target the active one', async () => {
    // Arrange
    const fake = createFakePorts({ connectionConfig: TWO_TARGETS });

    // Act
    const result = await runProcedure(useTarget, { name: 'remote' }, fake);

    // Assert
    expect(result.active).toBe(true);
    expect(fake.savedConnections[0]?.current).toBe('remote');
  });

  it('refuses an unknown target name and changes nothing', async () => {
    // Arrange
    const fake = createFakePorts({ connectionConfig: TWO_TARGETS });

    // Act
    const attempt = runProcedure(useTarget, { name: 'nope' }, fake);

    // Assert
    await expect(attempt).rejects.toThrow(ArgumentError);
    expect(fake.savedConnections).toEqual([]);
  });
});

describe('target rm', () => {
  it('removes the target and clears the active selection when it was active', async () => {
    // Arrange
    const fake = createFakePorts({ connectionConfig: TWO_TARGETS });

    // Act
    await runProcedure(removeTarget, { name: 'local' }, fake);

    // Assert
    expect(fake.savedConnections[0]).toEqual({
      current: null,
      targets: {
        remote: { url: 'https://factory.example', token: 'sup_remote' },
      },
    });
  });
});
