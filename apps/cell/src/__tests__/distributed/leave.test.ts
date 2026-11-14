import { afterEach, describe, expect, it } from 'vitest';
import { runsIn } from './harness/cell-proc';
import {
  createWorld,
  ofType,
  orderOf,
  statusOf,
  todo,
  until,
  type World,
} from './harness/world';

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

describe('a Cell told to leave mid-Cycle', () => {
  it('hands its Station over, exits cleanly, and the next Cell continues without the Supervisor', async () => {
    world = await createWorld({ 'add-login': todo('Add login') });
    const w = world;
    const order = orderOf('add-login');

    // Cell A's builder answers a handover request, the way an Operator does when it is asked to leave.
    const a = await w.cell('cell-a', {
      scenarios: { builder: 'hand-over-on-request' },
    });
    await until(
      () => runsIn(a.root).some((run) => run.role === 'builder'),
      'cell A to start its builder',
    );
    const b = await w.cell('cell-b');

    // SIGTERM: a graceful leave. A asks its Operator to hand over, checkpoints, and exits.
    const exitCode = await a.term();
    expect(exitCode).toBe(0);
    expect(a.output()).toContain('SIGTERM, leaving');

    await until(
      async () => (await statusOf(w, 'add-login')) === 'delivered',
      'cell B to deliver the Work order after the handover',
      90_000,
    );

    const events = await w.eventsOf(order);

    // The Station was handed over, not blocked and not failed.
    const handedOver = ofType(events, 'cycle_handed_over');
    expect(handedOver).toHaveLength(1);
    expect(ofType(events, 'cycle_failed')).toHaveLength(0);
    // Jobs the leaving Cell released are lost to `cell_left`, never to an expired lease (PROTOCOL §9).
    expect(ofType(events, 'job_lost').map((lost) => lost.reason)).not.toContain(
      'lease_expired',
    );

    // Cell B resumed the build from the handover checkpoint.
    const handoverCommit = handedOver[0]?.commit;
    const builds = ofType(events, 'cycle_started').filter(
      (cycle) => cycle.stationId === 'build',
    );
    expect(builds).toHaveLength(2);
    expect(builds.at(-1)?.baseCommit).toBe(handoverCommit);
    expect(builds.at(-1)?.cause).toEqual({
      kind: 'handover',
      of: handedOver[0]?.cycleId,
    });
    expect(ofType(events, 'job_claimed').at(-1)?.cellId).toBe(b.cellId);

    // No Supervisor was involved: no Supervisor command, no resume, no reopen.
    expect(events.some((stored) => stored.actor.kind === 'supervisor')).toBe(
      false,
    );
    expect(ofType(events, 'resumed')).toHaveLength(0);

    // A took no work after it was told to leave: its last claim is the one it released.
    const lastClaimByA = ofType(events, 'job_claimed')
      .filter((claim) => claim.cellId === a.cellId)
      .at(-1);
    const released = ofType(events, 'job_lost').filter(
      (lost) => lost.reason === 'cell_left',
    );
    expect(released.map((lost) => lost.jobId)).toEqual([lastClaimByA?.jobId]);
  }, 150_000);
});
