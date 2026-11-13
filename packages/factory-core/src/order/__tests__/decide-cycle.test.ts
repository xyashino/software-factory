import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import type { OrderEvent } from '../events';
import {
  blobOf,
  commitOf,
  contextOf,
  created,
  cycleFailed,
  cycleIdOf,
  jobIdOf,
  questionAsked,
  questionIdOf,
  stationOf,
  workerIdOf,
} from './builders';
import {
  begun,
  claim,
  deliveringEvents,
  passedStation,
  passedVerdict,
  start,
  stateOf,
} from './histories';

const worker = (epoch: number, id = 1) =>
  contextOf({ kind: 'worker', workerId: workerIdOf(id) }, { epoch });
const operator = (cycle: number, epoch: number) =>
  contextOf(
    { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(cycle) },
    { epoch },
  );
const plannedEvents = (): OrderEvent[] => [
  created(),
  claim(1),
  start(1, 'plan'),
];
const auditEvents = (): OrderEvent[] => [
  created(),
  ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
  ...passedStation(2, 'build', 4),
  ...begun(3, 'audit'),
];
const inspectionEvents = (): OrderEvent[] => [
  created(),
  ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
  ...passedStation(2, 'build', 4),
  ...passedVerdict(3, 5),
  claim(4, 'run_inspection'),
  start(4, 'check'),
];

describe('StartCycle', () => {
  const startCommand = { type: 'StartCycle' as const, baseCommit: commitOf(1) };

  it('starts the Cycle of the claimed Station job', () => {
    const state = stateOf([created(), claim(1)]);
    const command = {
      ...startCommand,
      operator: { profile: 'planner', runner: 'claude', model: 'opus' },
      promptBlob: blobOf(6),
    };

    const result = decide(state, command, worker(1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_started',
          cycleId: cycleIdOf(1),
          jobId: jobIdOf(1),
          stationId: stationOf('plan'),
          n: 1,
          cause: { kind: 'first' },
          baseCommit: commitOf(1),
          operator: { profile: 'planner', runner: 'claude', model: 'opus' },
          promptBlob: blobOf(6),
        },
      ],
    });
  });

  it('starts on the checkpoint the job was claimed on', () => {
    const state = stateOf([
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      claim(2),
    ]);

    const result = decide(
      state,
      { type: 'StartCycle', baseCommit: commitOf(2) },
      worker(2),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          type: 'cycle_started',
          stationId: stationOf('build'),
          baseCommit: commitOf(2),
        },
      ],
    });
  });

  it('refuses a base that is not the checkpoint of the job', () => {
    const state = stateOf([
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      claim(2),
    ]);

    const result = decide(
      state,
      { type: 'StartCycle', baseCommit: commitOf(9) },
      worker(2),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: `the base is not ${commitOf(2)}` },
    });
  });

  it('refuses a second start of the same Cycle', () => {
    const result = decide(stateOf(plannedEvents()), startCommand, worker(1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Cycle has already started' },
    });
  });

  it('refuses a delivery job, which has no Station', () => {
    const state = stateOf([...deliveringEvents(), claim(5, 'deliver')]);

    const result = decide(state, startCommand, worker(5));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the claimed job is not a Station job',
      },
    });
  });

  it('refuses a prompt that does not exist', () => {
    const state = stateOf([created(), claim(1)]);
    const ctx = contextOf(
      { kind: 'worker', workerId: workerIdOf(1) },
      { epoch: 1, missing: [blobOf(6)] },
    );

    const result = decide(
      state,
      { ...startCommand, promptBlob: blobOf(6) },
      ctx,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(6)} does not exist`] },
    });
  });

  it('refuses a stale epoch', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, startCommand, worker(2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });

  it('refuses an operator actor', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, startCommand, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor operator may not run this command',
      },
    });
  });
});

describe('CompleteCycle', () => {
  const complete = (
    artifacts: Record<string, ReturnType<typeof blobOf>> = { plan: blobOf(2) },
  ) => ({
    type: 'CompleteCycle' as const,
    cycleId: cycleIdOf(1),
    artifacts,
    commit: commitOf(2),
  });

  it('completes an operator Station with its declared artifact', () => {
    const result = decide(stateOf(plannedEvents()), complete(), operator(1, 1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_completed',
          cycleId: cycleIdOf(1),
          artifacts: { plan: blobOf(2) },
          commit: commitOf(2),
        },
      ],
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(stateOf(plannedEvents()), complete(), operator(1, 2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, complete(), operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a verdict Station, which completes with a verdict', () => {
    const command = { ...complete(), cycleId: cycleIdOf(3) };

    const result = decide(stateOf(auditEvents()), command, operator(3, 3));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'audit is a verdict Station' },
    });
  });

  it('refuses a missing declared artifact', () => {
    const result = decide(
      stateOf(plannedEvents()),
      complete({}),
      operator(1, 1),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: ['artifact plan is missing'] },
    });
  });

  it('refuses an artifact that does not exist', () => {
    const ctx = contextOf(
      { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(1) },
      { epoch: 1, missing: [blobOf(2)] },
    );

    const result = decide(stateOf(plannedEvents()), complete(), ctx);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: ['artifact plan does not exist'] },
    });
  });

  it('refuses an empty artifact', () => {
    const ctx = contextOf(
      { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(1) },
      { epoch: 1, empty: [blobOf(2)] },
    );

    const result = decide(stateOf(plannedEvents()), complete(), ctx);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: ['artifact plan is empty'] },
    });
  });

  it('abandons the open question before it completes the Cycle', () => {
    const state = stateOf([...plannedEvents(), questionAsked()]);

    const result = decide(state, complete(), operator(1, 1));

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'question_abandoned',
      'cycle_completed',
    ]);
  });

  it('refuses a worker actor', () => {
    const result = decide(stateOf(plannedEvents()), complete(), worker(1));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor worker may not run this command',
      },
    });
  });
});

describe('SubmitVerdict', () => {
  const verdict = (
    pass: boolean,
    feedbackBlob?: ReturnType<typeof blobOf>,
  ) => ({
    type: 'SubmitVerdict' as const,
    cycleId: cycleIdOf(3),
    pass,
    artifacts: { review: blobOf(3) },
    feedbackBlob,
    commit: commitOf(5),
  });

  it('records a passing verdict', () => {
    const result = decide(
      stateOf(auditEvents()),
      verdict(true),
      operator(3, 3),
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'verdict_recorded',
          cycleId: cycleIdOf(3),
          pass: true,
          artifacts: { review: blobOf(3) },
          feedbackBlob: undefined,
          commit: commitOf(5),
        },
      ],
    });
  });

  it('records a failing verdict with its feedback', () => {
    const result = decide(
      stateOf(auditEvents()),
      verdict(false, blobOf(4)),
      operator(3, 3),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'verdict_recorded', pass: false, feedbackBlob: blobOf(4) },
      ],
    });
  });

  it('refuses a failing verdict without feedback', () => {
    const result = decide(
      stateOf(auditEvents()),
      verdict(false),
      operator(3, 3),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: ['a failing verdict needs feedbackBlob'],
      },
    });
  });

  it('refuses a Station that is not a verdict', () => {
    const command = { ...verdict(true), cycleId: cycleIdOf(1) };

    const result = decide(stateOf(plannedEvents()), command, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'plan is not a verdict Station' },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(3)]);

    const result = decide(state, verdict(true), operator(3, 3));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(3) },
    });
  });

  it('refuses feedback that does not exist', () => {
    const ctx = contextOf(
      { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(3) },
      { epoch: 3, missing: [blobOf(4)] },
    );

    const result = decide(
      stateOf(auditEvents()),
      verdict(false, blobOf(4)),
      ctx,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(4)} does not exist`] },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(
      stateOf(auditEvents()),
      verdict(true),
      operator(3, 2),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 3 },
    });
  });

  it('abandons the open question before it records the verdict', () => {
    const state = stateOf([
      ...auditEvents(),
      questionAsked({ cycleId: cycleIdOf(3), questionId: questionIdOf(3) }),
    ]);

    const result = decide(state, verdict(true), operator(3, 3));

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'question_abandoned',
      'verdict_recorded',
    ]);
  });
});

describe('ReportInspection', () => {
  const report = (passed: boolean, logBlob = blobOf(5)) => ({
    type: 'ReportInspection' as const,
    cycleId: cycleIdOf(4),
    passed,
    results: [
      {
        command: 'pnpm test',
        exitCode: passed ? 0 : 1,
        timedOut: false,
        durationMs: 10,
        tail: 'done',
        logBlob,
      },
    ],
  });

  it('records the results of an Inspection', () => {
    const result = decide(stateOf(inspectionEvents()), report(true), worker(4));

    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'inspection_finished', cycleId: cycleIdOf(4), passed: true },
      ],
    });
  });

  it('refuses a Station that is not an Inspection', () => {
    const command = { ...report(true), cycleId: cycleIdOf(1) };

    const result = decide(stateOf(plannedEvents()), command, worker(1));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'plan is not an inspection Station',
      },
    });
  });

  it('refuses a log that does not exist', () => {
    const ctx = contextOf(
      { kind: 'worker', workerId: workerIdOf(1) },
      { epoch: 4, missing: [blobOf(5)] },
    );

    const result = decide(stateOf(inspectionEvents()), report(true), ctx);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(5)} does not exist`] },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      ...passedStation(2, 'build', 4),
      ...passedVerdict(3, 5),
      claim(4, 'run_inspection'),
    ]);

    const result = decide(state, report(true), worker(4));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(4) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(stateOf(inspectionEvents()), report(true), worker(3));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 4 },
    });
  });
});

describe('FailCycle', () => {
  const fail = {
    type: 'FailCycle' as const,
    cycleId: cycleIdOf(1),
    reason: 'crashed' as const,
    detail: 'runner exited',
  };

  it('fails a running Cycle', () => {
    const result = decide(stateOf(plannedEvents()), fail, worker(1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_failed',
          cycleId: cycleIdOf(1),
          reason: 'crashed',
          detail: 'runner exited',
          wipCommit: undefined,
        },
      ],
    });
  });

  it('abandons the open question before it fails the Cycle', () => {
    const state = stateOf([...plannedEvents(), questionAsked()]);

    const result = decide(state, fail, worker(1));

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'question_abandoned',
      'cycle_failed',
    ]);
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, fail, worker(1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(stateOf(plannedEvents()), fail, worker(2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });
});

describe('BlockCycle', () => {
  const operatorBlock = {
    type: 'BlockCycle' as const,
    cycleId: cycleIdOf(1),
    source: 'operator' as const,
    reason: 'operator_reported' as const,
    detail: 'needs a schema decision',
    handoverBlob: blobOf(4),
  };

  it('blocks with the Operator handover', () => {
    const result = decide(
      stateOf(plannedEvents()),
      operatorBlock,
      operator(1, 1),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'cycle_blocked', source: 'operator', handoverBlob: blobOf(4) },
      ],
    });
  });

  it('refuses an Operator block without its handover', () => {
    const command = { ...operatorBlock, handoverBlob: undefined };

    const result = decide(stateOf(plannedEvents()), command, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        issues: ['an operator block needs a handover'],
      },
    });
  });

  it('blocks from the runtime without a handover', () => {
    const runtime = {
      type: 'BlockCycle' as const,
      cycleId: cycleIdOf(1),
      source: 'runtime' as const,
      reason: 'runner_prompt' as const,
      detail: 'the runner asked a question',
    };

    const result = decide(stateOf(plannedEvents()), runtime, worker(1));

    expect(result).toMatchObject({
      ok: true,
      value: [
        { type: 'cycle_blocked', source: 'runtime', reason: 'runner_prompt' },
      ],
    });
  });

  it('refuses a handover that does not exist', () => {
    const ctx = contextOf(
      { kind: 'operator', workerId: workerIdOf(1), cycleId: cycleIdOf(1) },
      { epoch: 1, missing: [blobOf(4)] },
    );

    const result = decide(stateOf(plannedEvents()), operatorBlock, ctx);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(4)} does not exist`] },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, operatorBlock, operator(1, 1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(
      stateOf(plannedEvents()),
      operatorBlock,
      operator(1, 9),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });
});

describe('HandOverCycle', () => {
  const handover = {
    type: 'HandOverCycle' as const,
    cycleId: cycleIdOf(1),
    handoverBlob: blobOf(4),
  };

  it('hands the running Cycle over', () => {
    const result = decide(stateOf(plannedEvents()), handover, worker(1));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_handed_over',
          cycleId: cycleIdOf(1),
          handoverBlob: blobOf(4),
          commit: undefined,
        },
      ],
    });
  });

  it('refuses a handover that does not exist', () => {
    const ctx = contextOf(
      { kind: 'worker', workerId: workerIdOf(1) },
      { epoch: 1, missing: [blobOf(4)] },
    );

    const result = decide(stateOf(plannedEvents()), handover, ctx);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(4)} does not exist`] },
    });
  });

  it('refuses a Cycle that never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, handover, worker(1));

    expect(result).toEqual({
      ok: false,
      error: { code: 'not_live', cycleId: cycleIdOf(1) },
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(stateOf(plannedEvents()), handover, worker(2));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });
});

describe('RecordUsage', () => {
  const usage = {
    type: 'RecordUsage' as const,
    cycleId: cycleIdOf(1),
    model: 'claude-sonnet-5-5',
    inputTokens: 1200,
    outputTokens: 300,
  };

  it('records usage of a Cycle that already ended, without an epoch', () => {
    const state = stateOf([...plannedEvents(), cycleFailed()]);
    const ctx = contextOf({ kind: 'worker', workerId: workerIdOf(1) });

    const result = decide(state, usage, ctx);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'usage_recorded',
          cycleId: cycleIdOf(1),
          model: 'claude-sonnet-5-5',
          inputTokens: 1200,
          outputTokens: 300,
          costUsd: undefined,
        },
      ],
    });
  });

  it('refuses usage for a Cycle that is not in the history', () => {
    const ctx = contextOf({ kind: 'worker', workerId: workerIdOf(1) });

    const result = decide(
      stateOf(plannedEvents()),
      { ...usage, cycleId: cycleIdOf(7) },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses usage from a Worker that did not run the Cycle', () => {
    const ctx = contextOf({ kind: 'worker', workerId: workerIdOf(2) });

    const result = decide(stateOf(plannedEvents()), usage, ctx);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'only the Worker that ran the Cycle records usage',
      },
    });
  });
});
