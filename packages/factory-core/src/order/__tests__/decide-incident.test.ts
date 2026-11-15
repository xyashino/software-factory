import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { orderEventSchema, storedEventSchema } from '../events';
import {
  andonRaised,
  blobOf,
  cancelled,
  commitOf,
  contextOf,
  created,
  generatedIdOf,
  incidentIdOf,
  incidentRecorded,
  nudged,
  priorityChanged,
  resumed,
  samples,
} from './builders';
import { claim, start, stateOf } from './histories';

const mechanic = (name = 'mechanic', epoch = 2) =>
  contextOf({ kind: 'mechanic', name }, { epoch });
const supervisor = () => contextOf({ kind: 'supervisor', name: 'dev' });

const diagnosis = 'the Operator reported a block';
const outcome = 'the Work order resumed';

/** The incident the Mechanic writes for an Andon, as a command. */
const recordResume = {
  type: 'RecordIncident' as const,
  diagnosis,
  action: { kind: 'resume' as const },
  changes: [],
  outcome,
};

/** An open Andon: `andon_raised` is the second event, so it is stamped at 2000. */
const andonOpen = () =>
  stateOf([created(), andonRaised(), claim(2, 'mechanic')]);

describe('RecordIncident', () => {
  it('records one incident for the open Andon, by the Mechanic', () => {
    const result = decide(andonOpen(), recordResume, mechanic());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'incident_recorded',
          incidentId: generatedIdOf(1),
          by: 'mechanic',
          andonAt: 2000,
          andonReason: 'cycle_blocked',
          diagnosis,
          action: { kind: 'resume' },
          changes: [],
          outcome,
        },
      ],
    });
  });

  it('refuses any actor but the Mechanic', () => {
    const result = decide(andonOpen(), recordResume, supervisor());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only the mechanic may run this command',
      },
    });
  });

  it('refuses when no Andon is raised', () => {
    const result = decide(stateOf([created()]), recordResume, mechanic());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'no Andon is raised' },
    });
  });

  it('refuses a second incident for the same Andon', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      incidentRecorded({ andonAt: 2000 }),
    ]);

    const result = decide(state, recordResume, mechanic());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Andon already has an incident',
      },
    });
  });

  it('accepts an incident for a later Andon after an earlier one', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      claim(2, 'mechanic'),
      incidentRecorded({ andonAt: 2000 }),
      resumed(),
      andonRaised(),
      claim(3, 'mechanic'),
    ]);

    const result = decide(state, recordResume, mechanic('mechanic', 3));

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'incident_recorded', andonAt: 6000 }],
    });
  });

  it('refuses a repair that names no file or config', () => {
    const result = decide(
      andonOpen(),
      { ...recordResume, action: { kind: 'repair' } },
      mechanic(),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: ['a repair names the files or config it changed'],
      },
    });
  });

  it('refuses a change on a non-repair action', () => {
    const result = decide(
      andonOpen(),
      {
        ...recordResume,
        changes: [{ kind: 'file', path: 'config/cell.yaml', ref: commitOf(7) }],
      },
      mechanic(),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: ['resume changes no files or config'],
      },
    });
  });

  it('accepts a repair with a commit ref and a blob ref that exists', () => {
    const result = decide(
      andonOpen(),
      {
        ...recordResume,
        action: { kind: 'repair' },
        changes: [
          { kind: 'file', path: 'config/cell.yaml', ref: commitOf(7) },
          { kind: 'config', path: 'runner.json', ref: blobOf(8) },
        ],
      },
      mechanic(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'incident_recorded', action: { kind: 'repair' } }],
    });
  });

  it('refuses a repair whose blob does not exist', () => {
    const result = decide(
      andonOpen(),
      {
        ...recordResume,
        action: { kind: 'repair' },
        changes: [{ kind: 'config', path: 'runner.json', ref: blobOf(8) }],
      },
      contextOf(
        { kind: 'mechanic', name: 'mechanic' },
        { epoch: 2, missing: [blobOf(8)] },
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: [`blob ${blobOf(8)} does not exist`],
      },
    });
  });

  it('refuses an incident on a cancelled Work order', () => {
    const state = stateOf([created(), andonRaised(), cancelled()]);

    const result = decide(state, recordResume, mechanic());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Work order is cancelled',
      },
    });
  });
});

describe('Resume by the Mechanic', () => {
  const retry = {
    type: 'Resume' as const,
    mode: { kind: 'retry_station' as const },
  };

  it('is refused until the Mechanic has recorded the incident', () => {
    const result = decide(andonOpen(), retry, mechanic());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the mechanic records the incident before it resumes',
      },
    });
  });

  it('is accepted once the incident of this Andon exists', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      incidentRecorded({ andonAt: 2000 }),
    ]);

    const result = decide(state, retry, mechanic());

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'resumed', by: 'mechanic' }],
    });
  });

  it('is refused for a new Andon when the incident belongs to an earlier one', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      incidentRecorded({ andonAt: 2000 }),
      resumed(),
      andonRaised(),
    ]);

    const result = decide(state, retry, mechanic());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the mechanic records the incident before it resumes',
      },
    });
  });

  it('records the incident for the Supervisor resuming without one', () => {
    const result = decide(
      stateOf([created(), andonRaised()]),
      retry,
      supervisor(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'incident_recorded', by: 'dev', action: { kind: 'resume' } },
        { type: 'resumed', by: 'dev' },
      ],
    });
  });
});

describe('Mechanic authority', () => {
  it('may nudge a running Cycle', () => {
    const running = stateOf([created(), claim(1), start(1, 'plan')]);

    expect(
      decide(running, { type: 'Nudge', text: 'stop looping' }, mechanic()),
    ).toMatchObject({
      ok: true,
      value: [{ type: 'nudged', by: 'mechanic' }],
    });
  });

  it('may cancel a Work order', () => {
    expect(
      decide(
        stateOf([created()]),
        { type: 'Cancel', reason: 'cannot be repaired' },
        mechanic(),
      ),
    ).toMatchObject({ ok: true, value: [{ type: 'cancelled' }] });
  });

  it('is refused for any command that is not in its set', () => {
    const result = decide(
      stateOf([created()]),
      { type: 'Reprioritise', priority: 'high' },
      mechanic(),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor mechanic may not run this command',
      },
    });
  });
});

describe('incident_recorded in the Traveler', () => {
  it('folds the incident into the state, stamped with the event time', () => {
    const state = stateOf([
      created(),
      andonRaised(),
      incidentRecorded({ andonAt: 2000 }),
    ]);

    expect(state.incidents).toEqual([
      {
        incidentId: incidentIdOf(1),
        by: 'mechanic',
        andonAt: 2000,
        andonReason: 'cycle_blocked',
        diagnosis,
        action: { kind: 'resume' },
        changes: [],
        outcome,
        at: 3000,
      },
    ]);
  });

  it('starts with no incidents', () => {
    expect(stateOf([created()]).incidents).toEqual([]);
  });
});

describe('incident schemas', () => {
  it('accepts a mechanic actor and a stored incident', () => {
    expect(
      storedEventSchema.safeParse({
        schemaVersion: 2,
        seq: 3,
        globalSeq: 3,
        orderId: 'p:o',
        at: 3000,
        actor: { kind: 'mechanic', name: 'mechanic' },
        commandId: 'cmd-3',
        event: samples.incident_recorded,
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown action kind', () => {
    expect(
      orderEventSchema.safeParse({
        ...samples.incident_recorded,
        action: { kind: 'reboot' },
      }).success,
    ).toBe(false);
  });

  it('refuses a change ref that is neither a commit nor a blob', () => {
    expect(
      orderEventSchema.safeParse({
        ...samples.incident_recorded,
        action: { kind: 'repair' },
        changes: [{ kind: 'file', path: 'a.yaml', ref: 'main' }],
      }).success,
    ).toBe(false);
  });

  it('refuses more than 16 changes', () => {
    const change = { kind: 'file', path: 'a.yaml', ref: commitOf(1) };
    expect(
      orderEventSchema.safeParse({
        ...samples.incident_recorded,
        action: { kind: 'repair' },
        changes: Array.from({ length: 17 }, () => change),
      }).success,
    ).toBe(false);
  });

  it('keeps a priority change and a nudge valid next to the incident', () => {
    expect(orderEventSchema.safeParse(priorityChanged()).success).toBe(true);
    expect(orderEventSchema.safeParse(nudged()).success).toBe(true);
  });
});
