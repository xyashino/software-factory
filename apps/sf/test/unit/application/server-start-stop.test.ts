import { describe, expect, it } from 'vitest';
import { startServer } from '../../../src/application/procedures/server/start.procedure';
import { stopServer } from '../../../src/application/procedures/server/stop.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const URL = 'http://127.0.0.1:7070';
const DATA_DIR = '/data';
const DEAD_PID = 4242;
const SPAWNED_PID = 5001;

const startInput = {
  bin: '/usr/bin/bun',
  serverArgs: ['/repo/server.ts'],
  cwd: '/repo',
  dataDir: DATA_DIR,
  dbPath: '/data/factory.db',
  port: 7070,
};

const stubMinting = (fake: ReturnType<typeof createFakePorts>): void => {
  fake.ports.process.run = async () => ({
    exitCode: 0,
    stdout: 'minted\n',
    stderr: '',
  });
};

describe('factory server start', () => {
  it('refuses to start when another process answers on the url', async () => {
    // Arrange
    const fake = createFakePorts();

    // Act
    const started = runProcedure(startServer, startInput, fake);

    // Assert
    await expect(started).rejects.toThrow(
      `something already answers on ${URL}, not started by sf`,
    );
    expect(fake.spawned).toEqual([]);
    expect(fake.pidFile).toBeNull();
  });

  it('removes a stale pid file when it refuses a foreign listener', async () => {
    // Arrange
    const fake = createFakePorts({ pidFile: DEAD_PID });

    // Act
    const started = runProcedure(startServer, startInput, fake);

    // Assert
    await expect(started).rejects.toThrow('not started by sf');
    expect(fake.pidFile).toBeNull();
  });

  it('refuses to start while the recorded server pid is alive', async () => {
    // Arrange
    const fake = createFakePorts({
      listening: 'after-spawn',
      pidFile: DEAD_PID,
      alivePids: [DEAD_PID],
    });

    // Act
    const started = runProcedure(startServer, startInput, fake);

    // Assert
    await expect(started).rejects.toThrow('server already running');
    expect(fake.spawned).toEqual([]);
  });

  it('records the spawned pid when the server answers', async () => {
    // Arrange
    const fake = createFakePorts({ listening: 'after-spawn' });
    stubMinting(fake);

    // Act
    const result = await runProcedure(startServer, startInput, fake);

    // Assert
    expect(result).toEqual({ pid: SPAWNED_PID });
    expect(fake.pidFile).toBe(SPAWNED_PID);
    expect(fake.spawned).toHaveLength(1);
  });

  it('fails with the log tail when the child exits before answering', async () => {
    // Arrange
    const fake = createFakePorts({
      listening: 'after-spawn',
      serverLog: 'booting\nlisten EADDRINUSE 127.0.0.1:7070',
    });
    const spawnAndExit = fake.ports.process.spawnDetached;
    fake.ports.process.spawnDetached = async (spec) => {
      const pid = await spawnAndExit(spec);
      fake.alivePids.delete(pid);
      return pid;
    };

    // Act
    const started = runProcedure(startServer, startInput, fake);

    // Assert
    await expect(started).rejects.toThrow(
      /exited on start\n[\s\S]*listen EADDRINUSE 127\.0\.0\.1:7070/,
    );
    expect(fake.pidFile).toBeNull();
  });

  it('fails and stops the child when it stays alive but never answers', async () => {
    // Arrange
    const fake = createFakePorts({ listening: 'after-spawn' });
    fake.ports.server.probe = async () => false;

    // Act
    const started = runProcedure(startServer, startInput, fake);

    // Assert
    await expect(started).rejects.toThrow(
      'factory server did not answer within 10 s',
    );
    expect(fake.terminated).toEqual([SPAWNED_PID]);
    expect(fake.pidFile).toBeNull();
  });
});

describe('factory server stop', () => {
  it('stops the recorded server and clears the pid file', async () => {
    // Arrange
    const fake = createFakePorts({ pidFile: DEAD_PID, alivePids: [DEAD_PID] });

    // Act
    const result = await runProcedure(stopServer, { dataDir: DATA_DIR }, fake);

    // Assert
    expect(result).toEqual({ outcome: 'stopped' });
    expect(fake.terminated).toEqual([DEAD_PID]);
    expect(fake.pidFile).toBeNull();
  });

  it('reports not running without a warning when nothing answers', async () => {
    // Arrange
    const fake = createFakePorts({ listening: 'after-spawn' });

    // Act
    const result = await runProcedure(stopServer, { dataDir: DATA_DIR }, fake);

    // Assert
    expect(result).toEqual({ outcome: 'not-running' });
  });

  it('warns about a foreign listener when no pid file exists', async () => {
    // Arrange
    const fake = createFakePorts();

    // Act
    const result = await runProcedure(stopServer, { dataDir: DATA_DIR }, fake);

    // Assert
    expect(result).toEqual({
      outcome: 'not-running',
      warning: `something answers on ${URL}, not started by sf`,
    });
  });

  it('warns about a foreign listener when the recorded pid is dead', async () => {
    // Arrange
    const fake = createFakePorts({ pidFile: DEAD_PID });

    // Act
    const result = await runProcedure(stopServer, { dataDir: DATA_DIR }, fake);

    // Assert
    expect(result).toEqual({
      outcome: 'not-running',
      warning: `something answers on ${URL}, not started by sf`,
    });
    expect(fake.pidFile).toBeNull();
    expect(fake.terminated).toEqual([]);
  });
});
