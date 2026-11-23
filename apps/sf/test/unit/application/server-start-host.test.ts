import { describe, expect, it } from 'vitest';
import { startServer } from '../../../src/application/procedures/server/start.procedure';
import { createFakePorts } from '../../support/fake-ports';

const SUPERVISOR = { kind: 'supervisor' } as const;

const spawnedEnvFor = async (
  host: string | undefined,
): Promise<Record<string, string>> => {
  const fake = createFakePorts({ listening: 'after-spawn' });
  const ports = {
    ...fake.ports,
    process: {
      ...fake.ports.process,
      run: async () => ({ exitCode: 0, stdout: 'minted\n', stderr: '' }),
    },
  };
  await startServer.execute(
    {
      bin: '/usr/bin/bun',
      serverArgs: ['/repo/server.ts'],
      cwd: '/repo',
      dataDir: '/data',
      dbPath: '/data/factory.db',
      port: 7070,
      ...(host === undefined ? {} : { host }),
    },
    { ...ports, token: SUPERVISOR, principal: SUPERVISOR } as never,
  );
  return { ...fake.spawned[0]?.env };
};

describe('factory server start host', () => {
  it('passes HQ_HOST to the server when given', async () => {
    // Arrange
    const host = '0.0.0.0';

    // Act
    const env = await spawnedEnvFor(host);

    // Assert
    expect(env.HQ_HOST).toBe('0.0.0.0');
  });

  it('leaves HQ_HOST unset when no host is given', async () => {
    // Arrange
    const host = undefined;

    // Act
    const env = await spawnedEnvFor(host);

    // Assert
    expect(env).not.toHaveProperty('HQ_HOST');
  });
});
