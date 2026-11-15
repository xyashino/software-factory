import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { holderOf } from '../status';
import { nextJob } from '../next-job';
import {
  andonRaised,
  contextOf,
  created,
  generatedIdOf,
  incidentRecorded,
  jobIdOf,
  jobLost,
} from './builders';
import { claim, stateOf } from './histories';

const mechanic = (epoch = 2) =>
  contextOf({ kind: 'mechanic', name: 'mechanic' }, { epoch });
const supervisor = () => contextOf({ kind: 'supervisor', name: 'dev' });
const factory = () => contextOf({ kind: 'factory' });

/** An Andon the Mechanic triages, with its job claimed (epoch 2). */
const triaging = () =>
  stateOf([created(), andonRaised(), claim(2, 'mechanic')]);

describe('the Mechanic job and the Andon', () => {
  it('ends the Mechanic job when its incident is recorded', () => {
    const state = triaging();
    const result = decide(
      state,
      {
        type: 'RecordIncident',
        diagnosis: 'the Operator reported a block',
        action: { kind: 'nudge' },
        changes: [],
        outcome: 'nudged the Cycle',
      },
      mechanic(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = stateOf([
      created(),
      andonRaised(),
      claim(2, 'mechanic'),
      ...result.value,
    ]);
    expect(after.activeJob).toBeUndefined();
    expect(nextJob(after)).toEqual({
      kind: 'await_supervisor',
      cause: 'andon',
    });
  });

  it('refuses a RecordIncident from a stale Mechanic epoch', () => {
    const result = decide(
      triaging(),
      {
        type: 'RecordIncident',
        diagnosis: 'the Operator reported a block',
        action: { kind: 'nudge' },
        changes: [],
        outcome: 'nudged the Cycle',
      },
      mechanic(1),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 2 },
    });
  });

  it('escalates to the Supervisor when the Mechanic records an escalate', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      claim(2, 'mechanic'),
      incidentRecorded({
        andonAt: 2000,
        action: { kind: 'escalate' },
        outcome: 'handed to the supervisor',
      }),
    ]);
    expect(holderOf(state)).toEqual({ kind: 'supervisor', cause: 'andon' });
    expect(state.andon?.triage).toBe('supervisor');
  });

  it('lets the factory escalate an Andon whose Mechanic budget is spent', () => {
    const spent = stateOf([
      created(),
      andonRaised(),
      claim(2, 'mechanic'),
      jobLost({ jobId: jobIdOf(2), epoch: 2 }),
      claim(3, 'mechanic'),
      jobLost({ jobId: jobIdOf(3), epoch: 3 }),
    ]);
    const result = decide(
      spent,
      {
        type: 'EscalateAndon',
        diagnosis: 'the mechanic budget of 2 is spent',
        outcome: 'handed to the supervisor',
      },
      factory(),
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'incident_recorded',
          incidentId: generatedIdOf(1),
          by: 'factory',
          andonAt: 2000,
          andonReason: 'cycle_blocked',
          diagnosis: 'the mechanic budget of 2 is spent',
          action: { kind: 'escalate' },
          changes: [],
          outcome: 'handed to the supervisor',
        },
      ],
    });
  });

  it('refuses an EscalateAndon from any actor but the factory', () => {
    const result = decide(
      stateOf([created(), andonRaised()]),
      { type: 'EscalateAndon', diagnosis: 'x', outcome: 'y' },
      supervisor(),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor supervisor may not run this command',
      },
    });
  });

  it('records the Supervisor cancelling an Andon without an incident', () => {
    const result = decide(
      stateOf([created(), andonRaised()]),
      { type: 'Cancel', reason: 'not wanted' },
      supervisor(),
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'incident_recorded', by: 'dev', action: { kind: 'cancel' } },
        { type: 'cancelled' },
      ],
    });
  });

  it('refuses a Mechanic cancel of an Andon it has not recorded', () => {
    const result = decide(
      stateOf([created(), andonRaised()]),
      { type: 'Cancel', reason: 'broken' },
      mechanic(),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the mechanic records the incident before it cancels',
      },
    });
  });

  it('refuses a Supervisor resume while the Mechanic job works on the Andon', () => {
    const result = decide(
      triaging(),
      { type: 'Resume', mode: { kind: 'retry_station' } },
      supervisor(),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the mechanic is working on the Andon',
      },
    });
  });

  it('keeps the Mechanic out of the Work order worktree commands', () => {
    // The Mechanic runs only these commands (CORE §14.3); every other one is refused.
    const refused = [
      { type: 'Reprioritise', priority: 'high' },
      { type: 'ExpireLease' },
    ] as const;
    for (const command of refused) {
      const result = decide(
        stateOf([created(), andonRaised(), claim(2, 'mechanic')]),
        command as never,
        mechanic(),
      );
      expect(result.ok).toBe(false);
    }
  });
});
