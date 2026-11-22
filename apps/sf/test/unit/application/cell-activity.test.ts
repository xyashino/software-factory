import { describe, expect, it } from 'vitest';
import { drainStateOf } from '../../../src/cell/drain-signal';
import {
  type CellRuntime,
  reportActivity,
} from '../../../src/application/procedures/cell/cell-runtime';
import { createFakePorts } from '../../support/fake-ports';

const SINCE = 1_000;

const runtimeOf = (
  options: { daemonCellId?: string } = {},
): { runtime: CellRuntime; daemonCalls: () => unknown[] } => {
  const fake = createFakePorts();
  const runtime: CellRuntime = {
    ports: fake.ports,
    session: { cellId: 'hq-cell-1', sessionToken: 'session-token' },
    projectId: 'proj-1',
    repoRoot: '/repo',
    logPath: '/repo/cell.log',
    signal: new AbortController().signal,
    drain: drainStateOf(),
    daemonCellId: options.daemonCellId,
  };
  return { runtime, daemonCalls: () => fake.daemonCalls };
};

describe('cell activity reports', () => {
  it('reports an idle claim wait to its factory daemon', async () => {
    // Arrange
    const { runtime, daemonCalls } = runtimeOf({
      daemonCellId: 'daemon-cell-1',
    });

    // Act
    await reportActivity(runtime, { state: 'idle', since: SINCE });

    // Assert
    expect(daemonCalls()).toEqual([
      {
        method: 'POST',
        route: '/cells/daemon-cell-1/activity',
        body: { state: 'idle', since: SINCE },
      },
    ]);
  });

  it('sends nothing when the Cell was not started by a daemon', async () => {
    // Arrange
    const { runtime, daemonCalls } = runtimeOf();

    // Act
    await reportActivity(runtime, { state: 'idle', since: SINCE });

    // Assert
    expect(daemonCalls()).toEqual([]);
  });
});
