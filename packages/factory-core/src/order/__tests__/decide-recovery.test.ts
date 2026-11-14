import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import type { CommandOf } from '../commands';
import { nextJob } from '../next-job';
import type { WorkOrderState } from '../state';
import { cellIdOf, commitOf, contextOf, created, stationOf } from './builders';
import { claim, passedStation, stateOf } from './histories';

const PR = 'https://github.com/example/software-factory/pull/42';
/** The default Line of the builders: plan, build, audit, check. */
const LINE_IDS = ['plan', 'build', 'audit', 'check'].map(stationOf);

const recover = (
  over: Partial<CommandOf<'RecoverOrder'>> = {},
): CommandOf<'RecoverOrder'> => ({
  type: 'RecoverOrder',
  passedStations: [stationOf('plan')],
  checkpoint: { commit: commitOf(5), afterStation: stationOf('plan') },
  ...over,
});

const fresh = (): WorkOrderState => stateOf([created()]);

const recovered = (): WorkOrderState => {
  const result = decide(fresh(), recover(), contextOf());
  if (!result.ok) throw new Error('setup refused');
  const events = result.value;
  return stateOf([created(), ...events]);
};

describe('RecoverOrder', () => {
  it('appends order_recovered for a passed prefix of the Line', () => {
    const result = decide(fresh(), recover(), contextOf());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'order_recovered',
          passedStations: [stationOf('plan')],
          checkpoint: { commit: commitOf(5), afterStation: stationOf('plan') },
        },
      ],
    });
  });

  it('refuses any actor but the factory', () => {
    const result = decide(
      fresh(),
      recover(),
      contextOf({ kind: 'cell', cellId: cellIdOf(1) }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor cell may not run this command',
      },
    });
  });

  it('refuses a Work order that already had a job claimed', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, recover(), contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'a job was claimed, so the Work order is not fresh',
      },
    });
  });

  it('refuses a Work order that has a Cycle in its history', () => {
    const state = stateOf([created(), ...passedStation(1, 'plan', 2)]);

    const result = decide(state, recover(), contextOf());

    expect(result.ok).toBe(false);
  });

  it('refuses a second recovery of the same Work order', () => {
    const result = decide(recovered(), recover(), contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Work order was already recovered',
      },
    });
  });

  it('refuses a passed list that is not a prefix of the Line', () => {
    const result = decide(
      fresh(),
      recover({
        passedStations: [stationOf('build')],
        checkpoint: { commit: commitOf(5), afterStation: stationOf('build') },
      }),
      contextOf(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'invalid' });
  });

  it('refuses a checkpoint whose afterStation is not the last passed Station', () => {
    const result = decide(
      fresh(),
      recover({
        checkpoint: { commit: commitOf(5), afterStation: null },
      }),
      contextOf(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('refuses a delivery unless every Station passed', () => {
    const result = decide(
      fresh(),
      recover({
        delivery: { prUrl: PR, commit: commitOf(6), state: 'open' },
      }),
      contextOf(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('refuses a recovery of a cancelled Work order', () => {
    const state = stateOf([
      created(),
      { type: 'cancelled', reason: 'superseded' },
    ]);

    const result = decide(state, recover(), contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order is cancelled' },
    });
  });
});

describe('order_recovered folded into the state', () => {
  it('records the passed Stations and the checkpoint, and leaves lastPassed empty', () => {
    const state = recovered();

    expect(state.recovered).toEqual([stationOf('plan')]);
    expect(state.checkpoint).toEqual({
      commit: commitOf(5),
      afterStation: stationOf('plan'),
    });
    expect(state.lastPassed).toEqual({});
    expect(state.phase).toEqual({ kind: 'stations', index: 1 });
  });

  it('resumes at the first Station after the passed ones, on the checkpoint', () => {
    const next = nextJob(recovered());

    expect(next).toEqual({
      kind: 'job',
      job: expect.objectContaining({
        kind: 'run_operator_station',
        stationId: stationOf('build'),
        n: 1,
        cause: { kind: 'first' },
        base: commitOf(5),
      }),
    });
  });

  it('delivers from the checkpoint when every Station passed', () => {
    const result = decide(
      fresh(),
      recover({
        passedStations: LINE_IDS,
        checkpoint: { commit: commitOf(5), afterStation: stationOf('check') },
      }),
      contextOf(),
    );
    if (!result.ok) throw new Error('setup refused');
    const state = stateOf([created(), ...result.value]);

    expect(state.phase).toEqual({ kind: 'delivering' });
    expect(nextJob(state)).toEqual({
      kind: 'job',
      job: { kind: 'deliver', base: commitOf(5) },
    });
  });

  it('is delivered when a PR exists, and then nothing runs', () => {
    const result = decide(
      fresh(),
      recover({
        passedStations: LINE_IDS,
        checkpoint: { commit: commitOf(5), afterStation: stationOf('check') },
        delivery: { prUrl: PR, commit: commitOf(5), state: 'open' },
      }),
      contextOf(),
    );
    if (!result.ok) throw new Error('setup refused');
    const state = stateOf([created(), ...result.value]);

    expect(state.phase).toEqual({ kind: 'delivered' });
    expect(state.delivery).toEqual({
      prUrl: PR,
      commit: commitOf(5),
      state: 'open',
    });
    expect(nextJob(state)).toEqual({ kind: 'done' });
  });
});
