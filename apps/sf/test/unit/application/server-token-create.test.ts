import { describe, expect, it } from 'vitest';
import { createServerToken } from '../../../src/application/procedures/server/token-create.procedure';
import type { Access } from '../../../src/domain/access';
import { createFakePorts, type FakeOptions } from '../../support/fake-ports';

const SUPERVISOR: Access = { kind: 'supervisor' };
const URL = 'http://127.0.0.1:7070';
const MINTED = 'sup_minted';

const input = (overrides: { save: boolean; global: boolean }) => ({
  bin: '/usr/bin/sf',
  serverArgs: ['__server'],
  cwd: '/home/u/work',
  dbPath: '/data/factory.db',
  url: URL,
  ...overrides,
});

const createWith = (
  options: FakeOptions,
  request: ReturnType<typeof input>,
) => {
  const fake = createFakePorts(options);
  const written: string[] = [];
  const ports = {
    ...fake.ports,
    process: {
      ...fake.ports.process,
      run: async () => ({ exitCode: 0, stdout: `${MINTED}\n`, stderr: '' }),
    },
    tokens: {
      ...fake.ports.tokens,
      write: async (secret: string) => {
        written.push(secret);
      },
    },
  };
  const result = createServerToken.execute(request, {
    ...ports,
    token: SUPERVISOR,
    principal: SUPERVISOR,
  });
  return { result, written, saved: fake.savedConnections };
};

describe('server token create --save', () => {
  it('saves the token as the local target outside a factory repo', async () => {
    // Arrange
    const options: FakeOptions = { config: null };

    // Act
    const { result, saved, written } = createWith(
      options,
      input({ save: true, global: false }),
    );

    // Assert
    expect(await result).toEqual({ token: null });
    expect(saved[0]?.targets.local).toEqual({ url: URL, token: MINTED });
    expect(written).toEqual([]);
  });

  it('writes the repo token file inside a factory repo', async () => {
    // Arrange
    const options: FakeOptions = { config: '{}' };

    // Act
    const { result, saved, written } = createWith(
      options,
      input({ save: true, global: false }),
    );

    // Assert
    expect(await result).toEqual({ token: null });
    expect(written).toEqual([MINTED]);
    expect(saved).toEqual([]);
  });

  it('saves globally inside a factory repo when --global is given', async () => {
    // Arrange
    const options: FakeOptions = { config: '{}' };

    // Act
    const { result, saved, written } = createWith(
      options,
      input({ save: true, global: true }),
    );

    // Assert
    expect(await result).toEqual({ token: null });
    expect(saved[0]?.targets.local?.token).toBe(MINTED);
    expect(written).toEqual([]);
  });

  it('prints the token and saves nothing without --save', async () => {
    // Arrange
    const options: FakeOptions = { config: null };

    // Act
    const { result, saved, written } = createWith(
      options,
      input({ save: false, global: false }),
    );

    // Assert
    expect(await result).toEqual({ token: MINTED });
    expect(saved).toEqual([]);
    expect(written).toEqual([]);
  });
});
