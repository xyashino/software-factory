import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { describeEvent, renderEventLine } from '../render/log-view';
import { plainPaint } from '../render/paint';

const CYCLE = '01J0000000000000000000000C';
const JOB = '01J0000000000000000000000J';
const CELL = '01J0000000000000000000000W';
const SHORT_CYCLE = '01J00000';
const BLOB = `sha256:${'a'.repeat(64)}`;

/** An event as the log shows it. The fixtures are partial, so they are cast to the stored shape. */
const event = (value: Record<string, unknown>): StoredEvent['event'] =>
  value as unknown as StoredEvent['event'];

const progress = (over: Record<string, unknown>) =>
  event({
    type: 'inspection_progress',
    cycleId: CYCLE,
    phase: 'finished',
    index: 1,
    total: 3,
    command: 'pnpm test',
    exitCode: 0,
    timedOut: false,
    durationMs: 12_000,
    ...over,
  });

const result = (exitCode: number, timedOut = false) => ({
  command: 'check',
  exitCode,
  timedOut,
  durationMs: 1,
  tail: 'status',
  logBlob: BLOB,
});

describe('the live inspection progress', () => {
  it('shows a check as it starts, with its place in the run', () => {
    const line = describeEvent(
      progress({
        phase: 'started',
        index: 1,
        total: 3,
        command: 'pnpm check-types',
        exitCode: undefined,
        timedOut: undefined,
        durationMs: undefined,
      }),
    );

    expect(line).toBe('▶ pnpm check-types (1/3)');
  });

  it('shows a passing check as it finishes, with its exit code and duration', () => {
    expect(
      describeEvent(progress({ index: 1, total: 3, durationMs: 12_000 })),
    ).toBe('✓ pnpm test (1/3) exit 0 (12s)');
  });

  it('shows a failing check with its exit code', () => {
    expect(
      describeEvent(
        progress({
          command: 'pnpm lint',
          index: 2,
          exitCode: 1,
          durationMs: 400,
        }),
      ),
    ).toBe('✗ pnpm lint (2/3) exit 1 (<1s)');
  });

  it('shows a check that timed out as timed out, not with an exit code', () => {
    expect(
      describeEvent(
        progress({
          index: 3,
          exitCode: null,
          timedOut: true,
          durationMs: 600_000,
        }),
      ),
    ).toBe('✗ pnpm test (3/3) timed out (10m00s)');
  });

  it('shows a duration past a minute as minutes and seconds', () => {
    expect(describeEvent(progress({ durationMs: 65_000 }))).toBe(
      '✓ pnpm test (1/3) exit 0 (1m05s)',
    );
  });

  it('counts the checks that passed when the inspection finishes', () => {
    const line = describeEvent(
      event({
        type: 'inspection_finished',
        cycleId: CYCLE,
        passed: false,
        results: [result(0), result(1), result(0)],
      }),
    );

    expect(line).toBe(`cycle ${SHORT_CYCLE} failed (2/3 checks)`);
  });

  it('does not count a timed out check as passed', () => {
    const line = describeEvent(
      event({
        type: 'inspection_finished',
        cycleId: CYCLE,
        passed: false,
        results: [result(0), result(0, true)],
      }),
    );

    expect(line).toBe(`cycle ${SHORT_CYCLE} failed (1/2 checks)`);
  });
});

describe('the Traveler summaries', () => {
  it('says whether the verdict passed or failed', () => {
    expect(
      describeEvent(
        event({
          type: 'verdict_recorded',
          cycleId: CYCLE,
          pass: true,
          artifacts: {},
        }),
      ),
    ).toBe(`cycle ${SHORT_CYCLE} verdict pass`);
    expect(
      describeEvent(
        event({
          type: 'verdict_recorded',
          cycleId: CYCLE,
          pass: false,
          artifacts: {},
        }),
      ),
    ).toBe(`cycle ${SHORT_CYCLE} verdict fail`);
  });

  it('gives the reason and detail of a failed cycle', () => {
    expect(
      describeEvent(
        event({
          type: 'cycle_failed',
          cycleId: CYCLE,
          reason: 'timed_out',
          detail: 'ran past the limit',
        }),
      ),
    ).toBe(`cycle ${SHORT_CYCLE} failed (timed_out): ran past the limit`);
  });

  it('leaves out the colon when a failed cycle has no detail', () => {
    expect(
      describeEvent(
        event({
          type: 'cycle_failed',
          cycleId: CYCLE,
          reason: 'crashed',
          detail: '',
        }),
      ),
    ).toBe(`cycle ${SHORT_CYCLE} failed (crashed)`);
  });

  it('gives the source, reason and detail of a blocked cycle', () => {
    expect(
      describeEvent(
        event({
          type: 'cycle_blocked',
          cycleId: CYCLE,
          source: 'operator',
          reason: 'operator_reported',
          detail: 'needs a decision',
        }),
      ),
    ).toBe(
      `cycle ${SHORT_CYCLE} blocked (operator/operator_reported): needs a decision`,
    );
  });

  it('gives the stage and detail of a workspace failure', () => {
    expect(
      describeEvent(
        event({
          type: 'workspace_failed',
          jobId: JOB,
          stage: 'fetch',
          detail: 'clone refused',
        }),
      ),
    ).toBe('fetch: clone refused');
  });

  it('gives the pull request url of a delivery', () => {
    expect(
      describeEvent(
        event({
          type: 'delivery_finished',
          jobId: JOB,
          prUrl: 'https://github.com/acme/app/pull/7',
          commit: 'b'.repeat(40),
        }),
      ),
    ).toBe('https://github.com/acme/app/pull/7');
  });

  it('gives the detail of a failed delivery', () => {
    expect(
      describeEvent(
        event({ type: 'delivery_failed', jobId: JOB, detail: 'push rejected' }),
      ),
    ).toBe('push rejected');
  });

  it('gives the model, tokens and cost of a usage record', () => {
    expect(
      describeEvent(
        event({
          type: 'usage_recorded',
          cycleId: CYCLE,
          model: 'opus',
          inputTokens: 100,
          outputTokens: 20,
          costUsd: 0.12,
        }),
      ),
    ).toBe('opus 100+20 tok ($0.1200)');
  });

  it('leaves out the cost of a usage record that has none', () => {
    expect(
      describeEvent(
        event({
          type: 'usage_recorded',
          cycleId: CYCLE,
          model: 'opus',
          inputTokens: 1,
          outputTokens: 2,
        }),
      ),
    ).toBe('opus 1+2 tok');
  });

  it('says which job a cell claimed, and its kind', () => {
    expect(
      describeEvent(
        event({
          type: 'job_claimed',
          jobId: JOB,
          kind: 'run_inspection',
          cellId: CELL,
          epoch: 1,
        }),
      ),
    ).toBe(`job ${JOB.slice(0, 8)} run_inspection on ${CELL}`);
  });

  it('says why a job was lost', () => {
    expect(
      describeEvent(
        event({
          type: 'job_lost',
          jobId: JOB,
          epoch: 1,
          reason: 'lease_expired',
        }),
      ),
    ).toBe('lease_expired');
  });

  it('says how an Order resumed, and who resumed it', () => {
    expect(
      describeEvent(
        event({
          type: 'resumed',
          resumeId: 'r1',
          by: 'dev',
          mode: { kind: 'retry_station' },
        }),
      ),
    ).toBe('retry_station by dev');
    expect(
      describeEvent(
        event({
          type: 'resumed',
          resumeId: 'r2',
          by: 'dev',
          mode: { kind: 'restart_from', stationId: 'build' },
        }),
      ),
    ).toBe('restart_from build by dev');
  });

  it('says which station an Order reopened at, and who reopened it', () => {
    expect(
      describeEvent(
        event({
          type: 'reopened',
          resumeId: 'r1',
          by: 'dev',
          stationId: 'build',
        }),
      ),
    ).toBe('build by dev');
  });
});

describe('the Traveler line', () => {
  it('carries the clock, sequence, type and summary of a progress event', () => {
    const stored = {
      schemaVersion: 2,
      seq: 7,
      globalSeq: 7,
      orderId: 'software-factory:todo-1',
      at: Date.UTC(2026, 10, 16, 9, 30, 5),
      actor: { kind: 'cell', cellId: CELL },
      commandId: 'c1',
      epoch: 1,
      event: progress({ index: 1, total: 1 }),
    } as unknown as StoredEvent;

    expect(renderEventLine(stored, plainPaint)).toBe(
      `09:30:05    7 inspection_progress  ✓ pnpm test (1/1) exit 0 (12s)`,
    );
  });
});
