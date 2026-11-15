import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CellId, CommitSha, OrderId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { commandIdOf, discoveryIn, factoryDataDirOf } from '../factory-client';

const CELL = '01J0000000000000000000000W' as CellId;
const ORDER = 'software-factory:feature-1' as OrderId;
const COMMIT = 'a'.repeat(40) as CommitSha;

describe('the data directory and its discovery file', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('takes the data directory from the environment, else the default', () => {
    expect(factoryDataDirOf({ FACTORY_DATA_DIR: '/var/factory' })).toBe(
      '/var/factory',
    );
    expect(factoryDataDirOf({})).toMatch(/\.local\/share\/factory$/);
  });

  it('reads the discovery file the server wrote', () => {
    dir = mkdtempSync(join(tmpdir(), 'factory-cell-discovery-'));
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:7878',
        token: 'tok',
        joinToken: 'join',
      }),
    );

    expect(discoveryIn(dir)).toEqual({
      url: 'http://127.0.0.1:7878',
      token: 'tok',
      joinToken: 'join',
    });
  });

  it('reads a damaged or missing discovery file as no server', () => {
    dir = mkdtempSync(join(tmpdir(), 'factory-cell-discovery-'));
    writeFileSync(join(dir, 'server.json'), '{"url":');

    expect(discoveryIn(dir)).toBeUndefined();
    expect(discoveryIn(join(dir, 'absent'))).toBeUndefined();
  });
});

describe('content-derived command ids', () => {
  const start: OrderCommand = { type: 'StartCycle', baseCommit: COMMIT };

  it('gives the same id to the same content', () => {
    const first = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: start,
    });
    const again = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: { ...start },
    });

    expect(again).toBe(first);
  });

  it('gives another id to another command, epoch or Cell', () => {
    const base = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: start,
    });
    const otherEpoch = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 2,
      command: start,
    });
    const report = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: { type: 'Nudge', text: 'x' },
    });

    expect(otherEpoch).not.toBe(base);
    expect(report).not.toBe(base);
  });

  it('ignores the order of keys in the command', () => {
    const reordered = {
      baseCommit: COMMIT,
      type: 'StartCycle',
    } as OrderCommand;

    expect(
      commandIdOf({
        cellId: CELL,
        orderId: ORDER,
        epoch: 1,
        command: reordered,
      }),
    ).toBe(
      commandIdOf({ cellId: CELL, orderId: ORDER, epoch: 1, command: start }),
    );
  });

  it('stays within the 128 characters the wire allows', () => {
    expect(
      commandIdOf({ cellId: CELL, orderId: ORDER, epoch: 1, command: start })
        .length,
    ).toBeLessThanOrEqual(128);
  });
});
