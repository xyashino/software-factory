import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import {
  createWorld,
  ofType,
  orderOf,
  remoteTip,
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

/** The global sequence of the first event of one type, in the Factory's feed order. */
const firstGlobalSeq = (
  events: StoredEvent[],
  type: StoredEvent['event']['type'],
): number | undefined =>
  events.find((stored) => stored.event.type === type)?.globalSeq;

describe('an Operator blocked on Cell A', () => {
  it('frees A for other work at once, and the Work order resumes on Cell B from its WIP checkpoint', async () => {
    world = await createWorld({
      'add-login': todo('Add login'),
      'add-logout': todo('Add logout'),
    });
    const w = world;
    const login = orderOf('add-login');
    const logout = orderOf('add-logout');

    // Cell A's first builder blocks with a handover; its later runs complete.
    const a = await w.cell('cell-a', { scenarios: { builder: ['block'] } });
    await until(
      async () => ofType(await w.eventsOf(login), 'andon_raised').length > 0,
      'the Andon of add-login to be raised',
      60_000,
    );

    // A takes the other Work order at once, without waiting for the Supervisor.
    await until(
      async () => ofType(await w.eventsOf(logout), 'job_claimed').length > 0,
      'cell A to claim the other Work order',
      60_000,
    );
    const blockedAt = firstGlobalSeq(await w.eventsOf(login), 'cycle_blocked');
    const claimedAt = firstGlobalSeq(await w.eventsOf(logout), 'job_claimed');
    expect(blockedAt).toBeDefined();
    expect(claimedAt).toBeGreaterThan(blockedAt ?? Number.MAX_SAFE_INTEGER);

    // The Supervisor resumes the Work order, and Cell B, which starts now, takes it over.
    const b = await w.cell('cell-b');
    await w.factory.client.call('resume', {
      orderId: login,
      commandId: 'resume-add-login',
      mode: { kind: 'retry_station' },
    });
    await until(
      async () => (await statusOf(w, 'add-login')) === 'delivered',
      'the Work order to be delivered after the resume',
      90_000,
    );

    const events = await w.eventsOf(login);
    const started = ofType(events, 'cycle_started');

    // Passed Stations are not run again: the plan and its review each started once.
    expect(started.filter((cycle) => cycle.stationId === 'plan')).toHaveLength(
      1,
    );
    expect(
      started.filter((cycle) => cycle.stationId === 'plan-review'),
    ).toHaveLength(1);

    // The resumed build starts from the checkpoint the blocked Cycle left, not from the old base.
    const blocked = ofType(events, 'cycle_blocked')[0];
    const resumedBuild = started
      .filter((cycle) => cycle.stationId === 'build')
      .at(-1);
    expect(blocked?.commit).toBeDefined();
    expect(resumedBuild?.baseCommit).toBe(blocked?.commit);
    // The checkpoint is a real commit on the remote, marked as the blocked Cycle's WIP.
    const trailer = Bun.spawnSync([
      'git',
      '-C',
      w.repo,
      'log',
      '-1',
      '--format=%B',
      blocked?.commit ?? 'HEAD',
    ]).stdout.toString();
    expect(trailer).toContain('Factory-Outcome: blocked');

    // The resume reached B, and Cell A never ran the resumed Station.
    const resumedOn = ofType(events, 'job_claimed').at(-1);
    expect(resumedOn?.cellId).toBe(b.cellId);
    expect(resumedOn?.cellId).not.toBe(a.cellId);
    expect(ofType(events, 'resumed')).toHaveLength(1);

    expect(await remoteTip(w, 'factory/add-login')).toBeDefined();
  }, 240_000);
});
