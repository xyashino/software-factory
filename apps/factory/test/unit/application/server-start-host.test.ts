import { describe, expect, it } from 'vitest';
import type { DetachedSpec } from '../../../src/application/ports/process.port';
import { startServer } from '../../../src/application/procedures/server/start.procedure';
import { createFakePorts } from '../../support/fake-ports';

const SUPERVISOR = { kind: 'supervisor' } as const;

const spawnedEnvFor = async (
  host: string | undefined,
): Promise<Record<string, string>> => {
  const spawned: DetachedSpec[] = [];
  const fake = createFakePorts().ports;
  const ports = {
    ...fake,
    server: { ...fake.server, probe: async () => true },
    pidFile: {
      ...fake.pidFile,
      read: async () => null,
      write: async () => undefined,
    },
    clock: { now: () => 0, sleep: async () => undefined },
    process: {
      ...fake.process,
      isAlive: () => false,
      spawnDetached: async (spec: DetachedSpec) => {
        spawned.push(spec);
        return 1;
      },
    },
  };
  await startServer.execute(
    {
      bin: '/usr/bin/bun',
      serverArgs: ['/repo/server.ts'],
      dataDir: '/data',
      dbPath: '/data/factory.db',
      port: 7070,
      ...(host === undefined ? {} : { host }),
    },
    { ...ports, token: SUPERVISOR, principal: SUPERVISOR } as never,
  );
  return { ...spawned[0]?.env };
};

describe('factory server start host', () => {
  it('passes FACTORY_HOST to the server when given', async () => {
    // Arrange
    const host = '0.0.0.0';

    // Act
    const env = await spawnedEnvFor(host);

    // Assert
    expect(env.FACTORY_HOST).toBe('0.0.0.0');
  });

  it('leaves FACTORY_HOST unset when no host is given', async () => {
    // Arrange
    const host = undefined;

    // Act
    const env = await spawnedEnvFor(host);

    // Assert
    expect(env).not.toHaveProperty('FACTORY_HOST');
  });
});
