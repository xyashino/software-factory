import { describe, expect, it } from 'vitest';
import { HEARTBEAT_INTERVAL_MS } from '../../src/config';
import { createCellControl } from '../../src/daemon/cell-control';
import type { Relay } from '../../src/daemon/relay';
import { createScale, type Scale } from '../../src/daemon/scale';
import { createSupervisor } from '../../src/daemon/supervisor';
import { createFakePorts, type FakePorts } from '../support/fake-ports';

const PROJECT = 'software-factory';
const REPO = '/repos/alpha';
const LOG_DIR = '/logs';
const ORDER = 'hq:feature-x';
const WORKTREE = '.worktrees/feature-x';
const LOST_LINE = 'worktree deleted, cell stopped\n';

interface Report {
  cellId: string;
  files: string[];
  aliveWhenReported: number;
}

interface Harness {
  fake: FakePorts;
  scale: Scale;
  reports: Report[];
  present: Set<string>;
}

const harnessOf = (hqAccepts = true): Harness => {
  const fake = createFakePorts();
  const present = new Set<string>();
  const reports: Report[] = [];
  const relay: Relay = {
    issue: (cellId) => `token-${cellId}`,
    hqCellIdOf: () => null,
    reportWorktreeMissing: async (cellId, files) => {
      reports.push({ cellId, files, aliveWhenReported: fake.alivePids.size });
      return hqAccepts;
    },
    handle: async () => new Response(null, { status: 404 }),
  };
  const supervisor = createSupervisor(fake.ports, LOG_DIR);
  const cells = createCellControl({ ports: fake.ports, supervisor, relay });
  const scale = createScale({
    alive: (cellId) => supervisor.has(cellId),
    clock: fake.ports.clock,
    gate: () => null,
    spawn: cells.spawn,
    stop: cells.stop,
    exists: async (path) => present.has(path),
    lose: cells.lose,
  });
  return { fake, scale, reports, present };
};

const startOneCell = async (harness: Harness): Promise<string> => {
  await harness.scale.set({ projectId: PROJECT, repoRoot: REPO, count: 1 });
  return harness.scale.list()[0]?.cells[0]?.cellId ?? '';
};

const runOrderIn = (harness: Harness, cellId: string): void => {
  harness.scale.report(cellId, {
    state: 'running',
    orderId: ORDER,
    since: harness.fake.ports.clock.now(),
  });
};

const tickAfterInterval = async (harness: Harness): Promise<void> => {
  await harness.fake.ports.clock.sleep(HEARTBEAT_INTERVAL_MS);
  await harness.scale.tick();
};

const worktreePath = `${REPO}/${WORKTREE}`;

describe('factory daemon worktree watch', () => {
  it('deleted worktree stops a running Cell and reports it to HQ', async () => {
    // Arrange
    const harness = harnessOf();
    const cellId = await startOneCell(harness);
    runOrderIn(harness, cellId);
    harness.present.add(worktreePath);
    await harness.scale.tick();
    harness.present.delete(worktreePath);

    // Act
    await tickAfterInterval(harness);

    // Assert
    expect(harness.reports).toEqual([
      { cellId, files: [WORKTREE], aliveWhenReported: 0 },
    ]);
    expect(harness.fake.terminated).toHaveLength(1);
    expect(
      harness.scale.list()[0]?.cells.map((cell) => cell.cellId),
    ).not.toContain(cellId);
  });

  it('a lost Cell keeps its log and gets the kill line', async () => {
    // Arrange
    const harness = harnessOf();
    const cellId = await startOneCell(harness);
    runOrderIn(harness, cellId);
    harness.present.add(worktreePath);
    await harness.scale.tick();
    harness.present.delete(worktreePath);

    // Act
    await tickAfterInterval(harness);

    // Assert
    expect(harness.fake.appended).toEqual([
      { path: `${LOG_DIR}/${cellId}.log`, text: LOST_LINE },
    ]);
  });

  it('an idle Cell is never checked', async () => {
    // Arrange
    const harness = harnessOf();
    const cellId = await startOneCell(harness);
    harness.scale.report(cellId, {
      state: 'idle',
      since: harness.fake.ports.clock.now(),
    });

    // Act
    await tickAfterInterval(harness);

    // Assert
    expect(harness.reports).toEqual([]);
    expect(harness.fake.terminated).toEqual([]);
    expect(harness.scale.list()[0]?.cells[0]?.cellId).toBe(cellId);
  });

  it('a Cell whose worktree never appeared is not stopped', async () => {
    // Arrange
    const harness = harnessOf();
    const cellId = await startOneCell(harness);
    runOrderIn(harness, cellId);

    // Act
    await tickAfterInterval(harness);

    // Assert
    expect(harness.reports).toEqual([]);
    expect(harness.fake.terminated).toEqual([]);
  });

  it('Cell is still stopped when HQ does not take the report', async () => {
    // Arrange
    const harness = harnessOf(false);
    const cellId = await startOneCell(harness);
    runOrderIn(harness, cellId);
    harness.present.add(worktreePath);
    await harness.scale.tick();
    harness.present.delete(worktreePath);

    // Act
    await tickAfterInterval(harness);

    // Assert
    expect(harness.reports).toHaveLength(1);
    expect(harness.fake.terminated).toHaveLength(1);
    expect(harness.fake.appended).toHaveLength(1);
  });

  it('one lost worktree is reported once across ticks', async () => {
    // Arrange
    const harness = harnessOf();
    const cellId = await startOneCell(harness);
    runOrderIn(harness, cellId);
    harness.present.add(worktreePath);
    await harness.scale.tick();
    harness.present.delete(worktreePath);
    await tickAfterInterval(harness);

    // Act
    await tickAfterInterval(harness);
    await tickAfterInterval(harness);

    // Assert
    expect(harness.reports).toHaveLength(1);
    expect(harness.fake.terminated).toHaveLength(1);
  });
});
