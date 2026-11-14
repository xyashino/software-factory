import { describe, expect, it } from 'vitest';
import { cellIdSchema } from '../../ids';
import type { QueueEntry } from '../types';
import { selectClaimable } from '../select';
import {
  NOW,
  OTHER_PROJECT,
  OTHER_CELL,
  PROJECT,
  CELL,
  entry,
  limits,
  orderOf,
  cell,
} from './builders';

const idsOf = (queue: readonly QueueEntry[]): string[] =>
  selectClaimable(queue, cell(), limits()).map((item) => item.orderId);

const claimableIds = (
  queue: readonly QueueEntry[],
  view = cell(),
  limitsView = limits(),
): string[] =>
  selectClaimable(queue, view, limitsView).map((item) => item.orderId);

describe('selectClaimable: the claimable rule', () => {
  it('offers a queued job with satisfied deps to a Cell that serves the project', () => {
    expect(claimableIds([entry()])).toEqual([orderOf('task-a')]);
  });

  it.each([
    ['holder is a Cell', { holder: 'cell' as const }],
    ['holder is the Supervisor', { holder: 'supervisor' as const }],
    ['holder is nobody (delivered or cancelled)', { holder: 'none' as const }],
  ])('skips a Work order when the %s', (_, change) => {
    expect(claimableIds([entry(change)])).toEqual([]);
  });

  it.each<[string, QueueEntry['next']]>([
    ['done', 'done'],
    ['busy', 'busy'],
    ['await_supervisor', 'await_supervisor'],
    ['raise_andon', 'raise_andon'],
  ])('skips a Work order whose next step is %s', (_, next) => {
    expect(claimableIds([entry({ next })])).toEqual([]);
  });

  it.each([
    ['waiting', { deps: 'waiting' as const }],
    ['broken', { deps: 'broken' as const }],
  ])('skips a Work order whose deps are %s', (_, change) => {
    expect(claimableIds([entry(change)])).toEqual([]);
  });

  it('skips a Work order whose project the Cell does not serve', () => {
    expect(claimableIds([entry({ projectId: OTHER_PROJECT })], cell())).toEqual(
      [],
    );
  });

  it('skips a Work order whose runner the Cell does not have', () => {
    expect(claimableIds([entry({ runner: 'operator-x' })])).toEqual([]);
  });

  it('offers a Work order when the Cell has its runner', () => {
    expect(
      claimableIds(
        [entry({ runner: 'operator-x' })],
        cell({ runners: ['operator-x'] }),
      ),
    ).toEqual([orderOf('task-a')]);
  });

  it('skips a Work order when the Cell lacks one required capability', () => {
    expect(
      claimableIds(
        [entry({ requiredCapabilities: ['docker', 'gpu'] })],
        cell({ capabilities: ['docker'] }),
      ),
    ).toEqual([]);
  });

  it('offers a Work order when the Cell has every required capability', () => {
    expect(
      claimableIds(
        [entry({ requiredCapabilities: ['docker', 'gpu'] })],
        cell({ capabilities: ['gpu', 'docker', 'extra'] }),
      ),
    ).toEqual([orderOf('task-a')]);
  });

  it('skips a Work order while the Cell is in an active cooldown', () => {
    const cooling = entry({
      avoidCells: [{ cellId: CELL, until: NOW + 1 }],
    });
    expect(claimableIds([cooling])).toEqual([]);
  });

  it('offers a Work order again once the cooldown has expired', () => {
    const expired = entry({
      avoidCells: [{ cellId: CELL, until: NOW }],
    });
    expect(claimableIds([expired])).toEqual([orderOf('task-a')]);
  });

  it('offers a Work order when only another Cell is in cooldown', () => {
    const cooledOther = entry({
      avoidCells: [{ cellId: OTHER_CELL, until: NOW + 1 }],
    });
    expect(claimableIds([cooledOther])).toEqual([orderOf('task-a')]);
  });

  it('skips a Work order when its project is at the concurrency limit', () => {
    expect(
      claimableIds(
        [entry()],
        cell(),
        limits({ perProjectRunning: { [PROJECT]: { max: 2, running: 2 } } }),
      ),
    ).toEqual([]);
  });

  it('offers a Work order when its project is under the concurrency limit', () => {
    expect(
      claimableIds(
        [entry()],
        cell(),
        limits({ perProjectRunning: { [PROJECT]: { max: 2, running: 1 } } }),
      ),
    ).toEqual([orderOf('task-a')]);
  });

  it('skips a Work order whose project has no limit row', () => {
    expect(
      claimableIds([entry()], cell(), limits({ perProjectRunning: {} })),
    ).toEqual([]);
  });

  it('skips every Work order when the Cell has no free slot', () => {
    expect(claimableIds([entry()], cell({ freeSlots: 0 }))).toEqual([]);
  });

  it('keeps only the claimable Work orders of a mixed queue', () => {
    const queue = [
      entry({ orderId: orderOf('busy'), holder: 'cell' }),
      entry({ orderId: orderOf('free') }),
      entry({ orderId: orderOf('blocked'), deps: 'waiting' }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('free')]);
  });

  it('matches the cooldown by the Cell id, not by the Cell list', () => {
    const otherCell = cell({
      cellId: cellIdSchema.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    });
    expect(
      claimableIds(
        [entry({ avoidCells: [{ cellId: CELL, until: NOW + 1 }] })],
        otherCell,
      ),
    ).toEqual([orderOf('task-a')]);
  });
});

describe('selectClaimable: ordering keys', () => {
  it('puts a high priority Work order before a medium one', () => {
    const queue = [
      entry({ orderId: orderOf('medium'), priority: 'medium' }),
      entry({ orderId: orderOf('high'), priority: 'high' }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('high'), orderOf('medium')]);
  });

  it('puts a medium priority Work order before a low one', () => {
    const queue = [
      entry({ orderId: orderOf('low'), priority: 'low' }),
      entry({ orderId: orderOf('medium'), priority: 'medium' }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('medium'), orderOf('low')]);
  });

  it('puts a resumed Work order first, even with a later orderId', () => {
    const queue = [
      entry({ orderId: orderOf('a-task'), resumed: false }),
      entry({ orderId: orderOf('z-task'), resumed: true }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('z-task'), orderOf('a-task')]);
  });

  it('puts a progressed Work order first, even with a later orderId', () => {
    const queue = [
      entry({ orderId: orderOf('a-task'), progressed: false }),
      entry({ orderId: orderOf('z-task'), progressed: true }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('z-task'), orderOf('a-task')]);
  });

  it('puts the Work order last served by this Cell first, even with a later orderId', () => {
    const queue = [
      entry({ orderId: orderOf('a-task') }),
      entry({ orderId: orderOf('z-task'), lastCellId: CELL }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('z-task'), orderOf('a-task')]);
  });

  it('does not prefer a Work order last served by another Cell', () => {
    const queue = [
      entry({ orderId: orderOf('a-task') }),
      entry({ orderId: orderOf('z-task'), lastCellId: OTHER_CELL }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('a-task'), orderOf('z-task')]);
  });

  it('puts the older Work order first when the other keys tie', () => {
    const queue = [
      entry({ orderId: orderOf('a-task'), createdAt: 2_000 }),
      entry({ orderId: orderOf('z-task'), createdAt: 1_000 }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('z-task'), orderOf('a-task')]);
  });

  it('breaks a full tie on createdAt by orderId, ascending', () => {
    const queue = [
      entry({ orderId: orderOf('task-c') }),
      entry({ orderId: orderOf('task-a') }),
      entry({ orderId: orderOf('task-b') }),
    ];
    expect(idsOf(queue)).toEqual([
      orderOf('task-a'),
      orderOf('task-b'),
      orderOf('task-c'),
    ]);
  });

  it('orders a project-prefixed orderId by its full string', () => {
    const queue = [
      entry({
        orderId: orderOf('task-a', OTHER_PROJECT),
        projectId: OTHER_PROJECT,
      }),
      entry({ orderId: orderOf('task-a') }),
    ];
    const view = cell({ projects: [PROJECT, OTHER_PROJECT] });
    const perProjectRunning = {
      [PROJECT]: { max: 2, running: 0 },
      [OTHER_PROJECT]: { max: 2, running: 0 },
    };
    expect(claimableIds(queue, view, limits({ perProjectRunning }))).toEqual([
      orderOf('task-a', OTHER_PROJECT),
      orderOf('task-a'),
    ]);
  });
});

describe('selectClaimable: key precedence', () => {
  it('lets priority beat resumed', () => {
    const queue = [
      entry({
        orderId: orderOf('low-resumed'),
        priority: 'low',
        resumed: true,
      }),
      entry({
        orderId: orderOf('high-plain'),
        priority: 'high',
        resumed: false,
      }),
    ];
    expect(idsOf(queue)).toEqual([
      orderOf('high-plain'),
      orderOf('low-resumed'),
    ]);
  });

  it('lets resumed beat progressed', () => {
    const queue = [
      entry({
        orderId: orderOf('progressed'),
        progressed: true,
        resumed: false,
      }),
      entry({ orderId: orderOf('resumed'), progressed: false, resumed: true }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('resumed'), orderOf('progressed')]);
  });

  it('lets progressed beat the warm worktree', () => {
    const queue = [
      entry({
        orderId: orderOf('warm'),
        lastCellId: CELL,
        progressed: false,
      }),
      entry({ orderId: orderOf('progressed'), progressed: true }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('progressed'), orderOf('warm')]);
  });

  it('lets the warm worktree beat createdAt', () => {
    const queue = [
      entry({ orderId: orderOf('older'), createdAt: 1_000 }),
      entry({
        orderId: orderOf('warm'),
        createdAt: 9_000,
        lastCellId: CELL,
      }),
    ];
    expect(idsOf(queue)).toEqual([orderOf('warm'), orderOf('older')]);
  });
});

describe('selectClaimable: determinism', () => {
  const a = entry({
    orderId: orderOf('task-a'),
    priority: 'high',
    createdAt: 3_000,
  });
  const b = entry({
    orderId: orderOf('task-b'),
    priority: 'low',
    resumed: true,
  });
  const c = entry({ orderId: orderOf('task-c'), createdAt: 1_000 });
  const d = entry({ orderId: orderOf('task-d'), createdAt: 1_000 });
  const e = entry({
    orderId: orderOf('task-e'),
    progressed: true,
    createdAt: 5_000,
  });
  const f = entry({
    orderId: orderOf('task-f'),
    lastCellId: CELL,
    createdAt: 2_000,
  });
  const g = entry({ orderId: orderOf('task-g'), holder: 'cell' });
  const queue = [a, b, c, d, e, f, g];

  it('gives the same order whatever order the queue arrives in', () => {
    const expected = idsOf(queue);
    expect(idsOf([...queue].reverse())).toEqual(expected);
    expect(idsOf([d, c, e, f, a, g, b])).toEqual(expected);
    expect(idsOf([e, a, g, c, f, b, d])).toEqual(expected);
  });

  it('does not mutate the queue it was given', () => {
    const before = queue.map((item) => item.orderId);
    selectClaimable(queue, cell(), limits());
    expect(queue.map((item) => item.orderId)).toEqual(before);
  });

  it('returns a new list, so the caller can change it', () => {
    const picked = selectClaimable(queue, cell(), limits());
    expect(picked).not.toBe(queue);
    expect(picked.length).toBeGreaterThan(0);
  });
});
