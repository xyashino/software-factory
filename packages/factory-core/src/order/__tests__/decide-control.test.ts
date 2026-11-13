import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import {
  andonRaised,
  blobOf,
  contextOf,
  created,
  cycleBlocked,
  cycleFailed,
  cycleIdOf,
  generatedIdOf,
  prStateChanged,
  questionAbandoned,
  questionAnswered,
  questionAsked,
  questionIdOf,
  stationOf,
  workerIdOf,
} from './builders';
import {
  begun,
  claim,
  deliveredEvents,
  passedStation,
  start,
  stateOf,
} from './histories';

const operator = (cycle: number, epoch: number) =>
  contextOf(
    { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(cycle) },
    { epoch },
  );
/** A fresh context per decision, so generated ids start at 1 in every test. */
const supervisor = () => contextOf({ kind: 'supervisor', name: 'dev' });
const planning = () => stateOf([created(), claim(1), start(1, 'plan')]);

describe('AskQuestion', () => {
  const ask = {
    type: 'AskQuestion' as const,
    cycleId: cycleIdOf(1),
    text: 'Which table owns the lease?',
  };

  it('asks the Supervisor a question on the running Cycle', () => {
    const result = decide(planning(), ask, operator(1, 1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'question_asked',
          cycleId: cycleIdOf(1),
          questionId: generatedIdOf(1),
          text: 'Which table owns the lease?',
        },
      ],
    });
  });

  it('refuses a second question while one is open', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
    ]);

    const result = decide(state, ask, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'a question is already open' },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, ask, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(planning(), ask, operator(1, 2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });

  it('refuses a worker actor', () => {
    const result = decide(
      planning(),
      ask,
      contextOf({ kind: 'worker', workerId: workerIdOf(1) }, { epoch: 1 }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor worker may not run this command',
      },
    });
  });
});

describe('Answer', () => {
  const answer = {
    type: 'Answer' as const,
    questionId: questionIdOf(1),
    text: 'The orders table owns it.',
  };

  it('answers the open question as the Supervisor', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
    ]);

    const result = decide(state, answer, supervisor());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'question_answered',
          questionId: questionIdOf(1),
          by: 'dev',
          text: 'The orders table owns it.',
        },
      ],
    });
  });

  it('answers a question whose Cycle was abandoned and not yet answered', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
      questionAbandoned(),
    ]);

    const result = decide(state, answer, supervisor());

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'question_answered', questionId: questionIdOf(1) }],
    });
  });

  it('refuses a question that was already answered', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
      questionAnswered(),
    ]);

    const result = decide(state, answer, supervisor());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the question is already answered',
      },
    });
  });

  it('refuses a question the Work order does not have', () => {
    const result = decide(planning(), answer, supervisor());

    expect(result).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses an actor that is not the Supervisor', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
    ]);

    const result = decide(state, answer, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only a supervisor may run this command',
      },
    });
  });
});

describe('LeaveNote', () => {
  const note = (to: string) => ({
    type: 'LeaveNote' as const,
    cycleId: cycleIdOf(1),
    to: to === 'supervisor' ? ('supervisor' as const) : stationOf(to),
    text: 'the plan keeps the api small',
  });

  it('leaves a note for a later Station', () => {
    const result = decide(planning(), note('build'), operator(1, 1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'note_left',
          cycleId: cycleIdOf(1),
          to: stationOf('build'),
          text: 'the plan keeps the api small',
        },
      ],
    });
  });

  it('leaves a note for the Supervisor', () => {
    const result = decide(planning(), note('supervisor'), operator(1, 1));

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'note_left', to: 'supervisor' }],
    });
  });

  it('refuses a note for an earlier Station', () => {
    const state = stateOf([
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      ...begun(2, 'build'),
    ]);
    const command = { ...note('plan'), cycleId: cycleIdOf(2) };

    const result = decide(state, command, operator(2, 2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'plan is not a later Station' },
    });
  });

  it('refuses a note to a Station the Line does not have', () => {
    const result = decide(planning(), note('deploy'), operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'deploy is not a later Station' },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, note('build'), operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(planning(), note('build'), operator(1, 4));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });
});

describe('Nudge', () => {
  const nudge = { type: 'Nudge' as const, text: 'focus on the tests first' };

  it('nudges the Cycle that is running', () => {
    const result = decide(planning(), nudge, supervisor());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'nudged',
          cycleId: cycleIdOf(1),
          by: 'dev',
          text: 'focus on the tests first',
        },
      ],
    });
  });

  it('refuses a nudge when no Cycle is running', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      cycleFailed(),
    ]);

    const result = decide(state, nudge, supervisor());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'no Cycle is running' },
    });
  });

  it('refuses an actor that is not the Supervisor', () => {
    const result = decide(planning(), nudge, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only a supervisor may run this command',
      },
    });
  });
});

describe('Resume', () => {
  const andonWith = (reason: 'retries_exhausted' | 'cycle_blocked') =>
    stateOf([created(), andonRaised({ reason })]);
  const retryStation = {
    type: 'Resume' as const,
    mode: { kind: 'retry_station' as const },
  };

  it('grants one retry by default when retries are exhausted', () => {
    const result = decide(
      andonWith('retries_exhausted'),
      retryStation,
      supervisor(),
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'resumed',
          resumeId: generatedIdOf(1),
          by: 'dev',
          mode: { kind: 'retry_station' },
          noteBlob: undefined,
          grantRetries: 1,
        },
      ],
    });
  });

  it('grants the retries the Supervisor asks for', () => {
    const result = decide(
      andonWith('retries_exhausted'),
      { ...retryStation, grantRetries: 3 },
      supervisor(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'resumed', grantRetries: 3 }],
    });
  });

  it('refuses a resume whose note blob does not exist', () => {
    const result = decide(
      andonWith('cycle_blocked'),
      { ...retryStation, noteBlob: blobOf(9) },
      contextOf({ kind: 'supervisor', name: 'dev' }, { missing: [blobOf(9)] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: [`blob ${blobOf(9)} does not exist`],
      },
    });
  });

  it('refuses a retry grant of zero', () => {
    const result = decide(
      andonWith('retries_exhausted'),
      { ...retryStation, grantRetries: 0 },
      supervisor(),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: ['grantRetries must be at least 1'] },
    });
  });

  it('grants nothing for another reason unless asked', () => {
    const result = decide(
      andonWith('cycle_blocked'),
      retryStation,
      supervisor(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [{ type: 'resumed', grantRetries: undefined }],
    });
  });

  it('resumes at a restart Station named by the Supervisor', () => {
    // plan passed, build blocked: the Work order stopped at build, so restarting at build is allowed.
    const blockedAtBuild = stateOf([
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      claim(2),
      start(2, 'build'),
      cycleBlocked({ cycleId: cycleIdOf(2) }),
      andonRaised({ reason: 'cycle_blocked' }),
    ]);
    const restart = {
      type: 'Resume' as const,
      mode: { kind: 'restart_from' as const, stationId: stationOf('build') },
    };

    const result = decide(blockedAtBuild, restart, supervisor());

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          type: 'resumed',
          mode: { kind: 'restart_from', stationId: stationOf('build') },
        },
      ],
    });
  });

  it('refuses a restart at a Station the Line does not have', () => {
    const restart = {
      type: 'Resume' as const,
      mode: { kind: 'restart_from' as const, stationId: stationOf('deploy') },
    };

    const result = decide(andonWith('cycle_blocked'), restart, supervisor());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'deploy is not in the Line' },
    });
  });

  it('refuses a resume when no Andon is raised', () => {
    const result = decide(stateOf([created()]), retryStation, supervisor());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'no Andon is raised' },
    });
  });

  it('refuses an actor that is not the Supervisor', () => {
    const result = decide(
      andonWith('cycle_blocked'),
      retryStation,
      contextOf(),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only a supervisor may run this command',
      },
    });
  });
});

describe('Reopen', () => {
  const reopen = { type: 'Reopen' as const, stationId: stationOf('build') };

  it('reopens a delivered Work order at a Station', () => {
    const result = decide(stateOf(deliveredEvents()), reopen, supervisor());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'reopened',
          resumeId: generatedIdOf(1),
          by: 'dev',
          stationId: stationOf('build'),
          noteBlob: undefined,
        },
      ],
    });
  });

  it('refuses a reopen of a Work order that is not delivered', () => {
    const result = decide(planning(), reopen, supervisor());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only a delivered Work order can be reopened',
      },
    });
  });

  it('refuses a reopen once the PR is merged', () => {
    const state = stateOf([...deliveredEvents(), prStateChanged()]);

    const result = decide(state, reopen, supervisor());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the PR is merged' },
    });
  });

  it('refuses a reopen whose note blob does not exist', () => {
    const result = decide(
      stateOf(deliveredEvents()),
      { ...reopen, noteBlob: blobOf(9) },
      contextOf({ kind: 'supervisor', name: 'dev' }, { missing: [blobOf(9)] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: [`blob ${blobOf(9)} does not exist`],
      },
    });
  });

  it('refuses a reopen at a Station the Line does not have', () => {
    const result = decide(
      stateOf(deliveredEvents()),
      { ...reopen, stationId: stationOf('deploy') },
      supervisor(),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'deploy is not in the Line' },
    });
  });
});
