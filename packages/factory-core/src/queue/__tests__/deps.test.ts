import { describe, expect, it } from 'vitest';
import { planSlugSchema, type OrderId, type PlanSlug } from '../../ids';
import type { BoardStatus } from '../../order/status';
import {
  type DepRow,
  boardStatusWithDeps,
  indexDeps,
  resolveDeps,
} from '../deps';
import { orderOf } from './builders';

const DEP: OrderId = orderOf('dep');

const row = (
  status: BoardStatus,
  prState: DepRow['prState'] = null,
): DepRow => ({ orderId: DEP, status, prState });

const withDep = (depRow: DepRow, policy: 'delivered' | 'merged') =>
  resolveDeps({ dependsOn: [DEP] }, [depRow], policy);

describe('resolveDeps: outcome of one dependency', () => {
  it('is satisfied when the Work order has no dependencies', () => {
    expect(resolveDeps({ dependsOn: [] }, [], 'merged')).toBe('satisfied');
  });

  it('is satisfied by a delivered dependency under the delivered policy', () => {
    expect(withDep(row('delivered', 'open'), 'delivered')).toBe('satisfied');
  });

  it('is satisfied by a merged dependency under the delivered policy', () => {
    expect(withDep(row('merged', 'merged'), 'delivered')).toBe('satisfied');
  });

  it('is satisfied by a merged dependency under the merged policy', () => {
    expect(withDep(row('merged', 'merged'), 'merged')).toBe('satisfied');
  });

  it('waits for a delivered dependency under the merged policy while its PR is open', () => {
    expect(withDep(row('delivered', 'open'), 'merged')).toBe('waiting');
  });

  it('breaks a delivered dependency under the merged policy when its PR was closed unmerged', () => {
    expect(withDep(row('delivered', 'closed'), 'merged')).toBe('broken');
  });

  it('is satisfied when the dependency names no Work order in the rows', () => {
    expect(resolveDeps({ dependsOn: [DEP] }, [], 'merged')).toBe('satisfied');
  });

  it('breaks on a cancelled dependency under the delivered policy', () => {
    expect(withDep(row('cancelled'), 'delivered')).toBe('broken');
  });

  it('breaks on a cancelled dependency under the merged policy', () => {
    expect(withDep(row('cancelled'), 'merged')).toBe('broken');
  });

  it.each<BoardStatus>([
    'queued',
    'running',
    'waiting_answer',
    'andon',
    'delivering',
  ])('waits for a dependency that is still %s', (status) => {
    expect(withDep(row(status), 'delivered')).toBe('waiting');
  });

  it('breaks when one dependency is broken and another waits', () => {
    const other: OrderId = orderOf('other');
    const outcome = resolveDeps(
      { dependsOn: [DEP, other] },
      [row('cancelled'), { orderId: other, status: 'running', prState: null }],
      'delivered',
    );
    expect(outcome).toBe('broken');
  });

  it('waits when one dependency is satisfied and another waits', () => {
    const other: OrderId = orderOf('other');
    const outcome = resolveDeps(
      { dependsOn: [DEP, other] },
      [
        row('delivered', 'open'),
        { orderId: other, status: 'queued', prState: null },
      ],
      'delivered',
    );
    expect(outcome).toBe('waiting');
  });

  it('is satisfied when every dependency is satisfied or missing', () => {
    const other: OrderId = orderOf('other');
    const outcome = resolveDeps(
      { dependsOn: [DEP, other] },
      [row('merged', 'merged')],
      'merged',
    );
    expect(outcome).toBe('satisfied');
  });
});

describe('boardStatusWithDeps: the dependency overlay', () => {
  it('shows a queued job that waits on its deps as waiting_deps', () => {
    expect(boardStatusWithDeps('queued', 'job', 'waiting')).toBe(
      'waiting_deps',
    );
  });

  it('shows a queued job with a broken dep as deps_broken', () => {
    expect(boardStatusWithDeps('queued', 'job', 'broken')).toBe('deps_broken');
  });

  it('keeps the base status of a queued job whose deps are satisfied', () => {
    expect(boardStatusWithDeps('queued', 'job', 'satisfied')).toBe('queued');
  });

  it.each<BoardStatus>([
    'running',
    'waiting_answer',
    'andon',
    'delivering',
    'delivered',
    'merged',
    'cancelled',
  ])('keeps the %s status even when its deps are not satisfied', (status) => {
    expect(boardStatusWithDeps(status, 'job', 'waiting')).toBe(status);
    expect(boardStatusWithDeps(status, 'job', 'broken')).toBe(status);
  });

  it('keeps queued when the next step is not a job', () => {
    expect(boardStatusWithDeps('queued', 'await_supervisor', 'broken')).toBe(
      'queued',
    );
  });
});

describe('resolveDeps: stacked outcome of an in-plan predecessor (CORE §12.4)', () => {
  const XYZ: PlanSlug = planSlugSchema.parse('xyz');
  const stacked = (
    depRow: DepRow,
    depPlan: PlanSlug | null = XYZ,
    entryPlan: PlanSlug | null = XYZ,
  ) =>
    resolveDeps(
      { dependsOn: [DEP], plan: entryPlan },
      [{ ...depRow, plan: depPlan }],
      'merged',
    );

  it('is satisfied by a delivered predecessor whose PR is open, even under the merged policy', () => {
    expect(stacked(row('delivered', 'open'))).toBe('satisfied');
  });

  it('is broken by a delivered predecessor whose PR was closed unmerged', () => {
    expect(stacked(row('delivered', 'closed'))).toBe('broken');
  });

  it('is broken by a cancelled predecessor', () => {
    expect(stacked(row('cancelled'))).toBe('broken');
  });

  it('is satisfied by a merged predecessor', () => {
    expect(stacked(row('merged', 'merged'))).toBe('satisfied');
  });

  it('is waiting while the predecessor is still queued or running', () => {
    expect(stacked(row('running'))).toBe('waiting');
    expect(stacked(row('queued'))).toBe('waiting');
  });

  it('keeps depPolicy for a dependency outside the plan', () => {
    expect(stacked(row('delivered', 'open'), null)).toBe('waiting');
    expect(stacked(row('delivered', 'open'), null, null)).toBe('waiting');
  });

  it('keeps depPolicy when the dependency is in another plan', () => {
    const other = planSlugSchema.parse('abc');
    // Under the merged policy an open delivered PR waits; the stacked rule would satisfy it.
    expect(stacked(row('delivered', 'open'), other)).toBe('waiting');
  });
});

describe('indexDeps: a pre-built index gives the array answer', () => {
  const ONE: OrderId = orderOf('one');
  const TWO: OrderId = orderOf('two');
  const rows: DepRow[] = [
    { orderId: ONE, status: 'delivered', prState: 'open' },
    { orderId: TWO, status: 'merged', prState: 'merged' },
  ];
  const entries = [
    { dependsOn: [] },
    { dependsOn: [ONE] },
    { dependsOn: [ONE, TWO] },
    { dependsOn: [orderOf('missing')] },
  ];

  it('resolves every entry the same from the array and from the index', () => {
    const index = indexDeps(rows);
    for (const policy of ['delivered', 'merged'] as const) {
      for (const entry of entries) {
        expect(resolveDeps(entry, index, policy)).toBe(
          resolveDeps(entry, rows, policy),
        );
      }
    }
  });

  it('keys each row by its order id', () => {
    const index = indexDeps(rows);
    expect(index.size).toBe(2);
    expect(index.get(TWO)?.status).toBe('merged');
  });
});
