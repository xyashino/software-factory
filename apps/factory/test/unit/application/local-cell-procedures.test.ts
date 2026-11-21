import { describe, expect, it } from 'vitest';
import { ArgumentError, Refused } from '../../../src/application/core/errors';
import { createLocalCells } from '../../../src/application/procedures/cell/local-create.procedure';
import {
  listCellsWithLocal,
  listLocalSlots,
} from '../../../src/application/procedures/cell/local-list.procedure';
import { removeLocalCell } from '../../../src/application/procedures/cell/local-rm.procedure';
import {
  stopAllLocalCells,
  stopLocalCell,
} from '../../../src/application/procedures/cell/local-stop.procedure';
import type { LocalSlot } from '../../../src/domain/cell/local-slot';
import {
  createFakePorts,
  runProcedure,
  type FakeOptions,
  type ServerCall,
} from '../../support/fake-ports';

const REPO = '/repo';
const FACTORY = 'http://127.0.0.1:7070';
const LAUNCHER = ['/usr/bin/sf'];

const slotOf = (overrides: Partial<LocalSlot>): LocalSlot => ({
  slotId: 'slot-a',
  name: 'dev-box',
  factory: FACTORY,
  repoRoot: REPO,
  pid: 111,
  state: 'running',
  createdAt: 1_000,
  ...overrides,
});

const tokenReply = (call: ServerCall): unknown => {
  if (call.route === '/api/v1/tokens') {
    return {
      code: 201,
      tokenId: 'tok-1',
      kind: 'cell_join',
      token: `join-${(call.body as { name: string }).name}`,
      scopes: [],
      expiresAt: null,
    };
  }
  return { code: 200, cells: [] };
};

const cellDto = (name: string, cellId: string): unknown => ({
  cellId,
  projectId: 'software-factory',
  name,
  status: 'online',
  allowedLines: ['*'],
  runners: [],
  activeJobId: null,
  lastHeartbeatAt: null,
  leaseExpiresAt: null,
});

const fakeFor = (options: FakeOptions = {}) =>
  createFakePorts({ reply: tokenReply, ...options });

const createInput = (overrides: Record<string, unknown> = {}) => ({
  repoRoot: REPO,
  count: 1,
  baseName: 'dev-box',
  launcher: LAUNCHER,
  ...overrides,
});

describe('local cell create', () => {
  it('starts two slots when asked for two', async () => {
    // Arrange
    const fake = fakeFor();

    // Act
    const created = await runProcedure(
      createLocalCells,
      createInput({ count: 2 }),
      fake,
    );

    // Assert
    expect(created.map((slot) => slot.name)).toEqual(['dev-box', 'dev-box-2']);
    expect(fake.spawned).toHaveLength(2);
    expect(fake.slots).toHaveLength(2);
  });

  it('starts the worker with the cell start command in the repo', async () => {
    // Arrange
    const fake = fakeFor();

    // Act
    await runProcedure(createLocalCells, createInput(), fake);

    // Assert
    expect(fake.spawned[0]).toMatchObject({
      args: [...LAUNCHER, 'cell', 'start', '--name', 'dev-box'],
      cwd: REPO,
      env: {
        FACTORY_URL: 'http://127.0.0.1:7070',
        FACTORY_JOIN_TOKEN: 'join-dev-box',
      },
    });
  });

  it('refuses a fixed name when more than one slot is asked for', async () => {
    // Arrange
    const fake = fakeFor();

    // Act
    const created = runProcedure(
      createLocalCells,
      createInput({ count: 2, name: 'shared' }),
      fake,
    );

    // Assert
    await expect(created).rejects.toBeInstanceOf(ArgumentError);
    expect(fake.spawned).toHaveLength(0);
  });

  it('refuses a fixed name that a live slot already holds', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ name: 'shared', pid: 111 })],
      alivePids: [111],
    });

    // Act
    const created = runProcedure(
      createLocalCells,
      createInput({ name: 'shared' }),
      fake,
    );

    // Assert
    await expect(created).rejects.toBeInstanceOf(Refused);
    expect(fake.spawned).toHaveLength(0);
  });

  it('skips names held by live slots when allocating', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ name: 'dev-box', pid: 111 })],
      alivePids: [111],
    });

    // Act
    const created = await runProcedure(createLocalCells, createInput(), fake);

    // Assert
    expect(created.map((slot) => slot.name)).toEqual(['dev-box-2']);
  });
});

describe('local cell list', () => {
  it('shows the pid only while the worker is alive', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [
        slotOf({ slotId: 'live', name: 'a', pid: 111 }),
        slotOf({ slotId: 'gone', name: 'b', pid: 222 }),
      ],
      alivePids: [111],
    });

    // Act
    const listed = await runProcedure(listLocalSlots, {}, fake);

    // Assert
    expect(listed.map((slot) => [slot.slotId, slot.pid])).toEqual([
      ['live', 111],
      ['gone', null],
    ]);
  });

  it('merges the Factory cell rows with the local pid of the same name', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ name: 'dev-box', pid: 111 })],
      alivePids: [111],
      reply: (call) =>
        call.route === '/api/v1/cells'
          ? {
              code: 200,
              cells: [
                cellDto('dev-box', 'cell-1'),
                cellDto('remote', 'cell-2'),
              ],
            }
          : tokenReply(call),
    });

    // Act
    const rows = await runProcedure(listCellsWithLocal, {}, fake);

    // Assert
    expect(rows.map((row) => [row.cellId, row.pid])).toEqual([
      ['cell-1', 111],
      ['cell-2', null],
    ]);
  });
});

describe('local cell stop', () => {
  it('terminates the worker and marks the slot stopped', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ slotId: 'slot-a', pid: 111 })],
      alivePids: [111],
    });

    // Act
    const stopped = await runProcedure(
      stopLocalCell,
      { id: 'slot-a', force: false },
      fake,
    );

    // Assert
    expect(fake.terminated).toEqual([111]);
    expect(stopped).toMatchObject({ state: 'stopped', pid: null });
    expect(fake.slots[0]).toMatchObject({ state: 'stopped', pid: null });
  });

  it('answers null for an id that is not a local slot', async () => {
    // Arrange
    const fake = fakeFor();

    // Act
    const stopped = await runProcedure(
      stopLocalCell,
      { id: 'remote-cell', force: false },
      fake,
    );

    // Assert
    expect(stopped).toBeNull();
    expect(fake.terminated).toEqual([]);
  });

  it('stops every running slot for --all', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [
        slotOf({ slotId: 'a', name: 'a', pid: 111 }),
        slotOf({ slotId: 'b', name: 'b', pid: 222, state: 'stopped' }),
      ],
      alivePids: [111],
    });

    // Act
    const stopped = await runProcedure(
      stopAllLocalCells,
      { force: false },
      fake,
    );

    // Assert
    expect(fake.terminated).toEqual([111]);
    expect(stopped.map((slot) => slot.state)).toEqual(['stopped', 'stopped']);
  });
});

describe('local cell rm', () => {
  it('refuses to remove a slot whose worker is alive', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ slotId: 'slot-a', pid: 111 })],
      alivePids: [111],
    });

    // Act
    const removed = runProcedure(removeLocalCell, { id: 'slot-a' }, fake);

    // Assert
    await expect(removed).rejects.toBeInstanceOf(Refused);
    expect(fake.slots).toHaveLength(1);
  });

  it('removes a stopped slot', async () => {
    // Arrange
    const fake = fakeFor({
      slots: [slotOf({ slotId: 'slot-a', pid: null, state: 'stopped' })],
    });

    // Act
    const removed = await runProcedure(removeLocalCell, { id: 'slot-a' }, fake);

    // Assert
    expect(removed).toBe('slot-a');
    expect(fake.slots).toEqual([]);
  });
});
