import { describe, expect, it } from 'vitest';
import type { Signal } from '@repo/factory-core/contracts/cell';
import type { JobId } from '@repo/factory-core/ids';
import { createJobRegistry } from '../jobs/registry';

const JOB = '01J0000000000000000000000J' as JobId;
const OTHER = '01J0000000000000000000000K' as JobId;

const nudge = (jobId: JobId, signalId: string): Signal => ({
  signalId,
  jobId,
  kind: 'nudge',
  text: 'keep going',
});

describe('job registry', () => {
  it('lists the jobs a Cell holds until they finish', () => {
    const registry = createJobRegistry();
    registry.start(JOB);

    expect(registry.activeJobIds()).toEqual([JOB]);

    registry.finish(JOB);

    expect(registry.activeJobIds()).toEqual([]);
  });

  it('aborts a job it holds with the reason given', () => {
    const registry = createJobRegistry();
    const { signal } = registry.start(JOB);

    registry.abort(JOB, 'stale: the lease moved on');

    expect(signal.aborted).toBe(true);
    expect(registry.abortReason(JOB)).toBe('stale: the lease moved on');
  });

  it('aborts every held job when the Cell is fenced', () => {
    const registry = createJobRegistry();
    const first = registry.start(JOB);
    const second = registry.start(OTHER);

    registry.abortAll('self-fenced');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });

  it('hands a signal to its job and nothing to another', () => {
    const registry = createJobRegistry();
    registry.start(JOB);

    const delivered = registry.deliver(nudge(JOB, 's1'));
    const stray = registry.deliver(nudge(OTHER, 's2'));

    expect(delivered).toBe(true);
    expect(stray).toBe(false);
    expect(registry.takeSignals(JOB)).toEqual([nudge(JOB, 's1')]);
    expect(registry.takeSignals(JOB)).toEqual([]);
  });
});
