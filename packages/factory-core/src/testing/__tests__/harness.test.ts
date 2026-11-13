import { describe, expect, it } from 'vitest';
import {
  blobOf,
  commitOf,
  created,
  makeLine,
  stationOf,
  workerIdOf,
} from '../event-builders';
import { fakeBlobs, fakeClock, fakeIds } from '../fakes';
import { actors, given } from '../harness';
import { lineBuilder } from '../line-builder';

const createOrder = () => ({ ...created(), type: 'CreateOrder' as const });
const claimJob = () => ({
  type: 'ClaimJob' as const,
  workerId: workerIdOf(1),
});
const startCycle = () => ({
  type: 'StartCycle' as const,
  baseCommit: commitOf(1),
});

describe('given and when', () => {
  it('creates a Work order from nothing', () => {
    given([]).when(createOrder()).then([created()]);
  });

  it('shows the diff when the events differ', () => {
    const attempt = () =>
      given([created()])
        .when(claimJob())
        .then([{ type: 'priority_changed', priority: 'low' }]);

    expect(attempt).toThrow(/events of ClaimJob/);
  });

  it('refuses a command on a Work order that does not exist', () => {
    given([]).when({ type: 'Cancel', reason: 'gone' }).thenError('not_found');
  });

  it('asserts a refusal by its code', () => {
    given([created()])
      .when(claimJob(), actors.worker(1))
      .thenError('precondition');
  });

  it('fails when the refusal has another code', () => {
    const attempt = () =>
      given([created()])
        .when(claimJob(), actors.worker(1))
        .thenError('invalid');

    expect(attempt).toThrow(/expected ClaimJob to be refused with invalid/);
  });

  it('fails when a refused command is asserted to emit events', () => {
    const attempt = () =>
      given([]).when({ type: 'Cancel', reason: 'gone' }).then([]);

    expect(attempt).toThrow(/Cancel was refused/);
  });

  it('chains a second command on the events of the first', () => {
    given([created()])
      .when(claimJob())
      .and(startCycle(), actors.worker(1))
      .thenTypes(['cycle_started']);
  });
});

describe('given and nextJob', () => {
  it('asks for the first Station job of a new Work order', () => {
    given([created()]).nextJob({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 1,
        cause: { kind: 'first' },
        base: 'branch_base',
      },
    });
  });

  it('is busy once the command claims the job', () => {
    given([created()]).when(claimJob()).nextJob({ kind: 'busy' });
  });
});

describe('the line builder', () => {
  it('builds the default Line of the harness', () => {
    const built = lineBuilder()
      .operator('plan', { artifacts: ['plan'] })
      .operator('build', { requires: ['docker'] })
      .operator('audit', {
        verdict: true,
        artifacts: ['review'],
        onFail: { retry: 'build', max: 2 },
      })
      .inspection('check', { onFail: { retry: 'build', max: 1 } })
      .build();

    expect(built).toEqual(makeLine());
  });

  it('rejects a retry that names no Station', () => {
    expect(() =>
      lineBuilder()
        .operator('build')
        .inspection('check', { onFail: { retry: 'nowhere', max: 1 } })
        .build(),
    ).toThrow();
  });
});

describe('the fakes', () => {
  it('moves the clock only when told to', () => {
    const clock = fakeClock(10);
    clock.advance(5);

    expect(clock.now()).toBe(15);
  });

  it('issues the same ids for the same calls', () => {
    const first = fakeIds();
    const second = fakeIds();

    expect(first.jobId()).toBe(second.jobId());
    expect(first.next()).toBe(second.next());
  });

  it('marks the blobs it was told are missing', () => {
    const blobs = fakeBlobs().missing(blobOf(1));

    expect(blobs.exists(blobOf(1))).toBe(false);
    expect(blobs.exists(blobOf(2))).toBe(true);
  });
});
