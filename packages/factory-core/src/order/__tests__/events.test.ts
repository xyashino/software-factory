import { describe, expect, it } from 'vitest';
import { orderEventSchema, storedEventSchema } from '../events';
import {
  blobOf,
  cancelled,
  created,
  cycleBlocked,
  cycleCompleted,
  cycleFailed,
  history,
  inspectionFinished,
  noteLeft,
  samples,
  verdictRecorded,
} from './builders';

const TYPES = Object.keys(samples) as (keyof typeof samples)[];

describe('event catalogue', () => {
  it('has every event type of CORE §3.3', () => {
    expect(orderEventSchema.options).toHaveLength(26);
  });

  it.each(TYPES)('accepts a valid %s event', (type) => {
    expect(orderEventSchema.safeParse(samples[type]).success).toBe(true);
  });

  it('rejects an unknown event type', () => {
    expect(
      orderEventSchema.safeParse({ type: 'order_teleported' }).success,
    ).toBe(false);
  });

  it('rejects an event that misses a required field', () => {
    const withoutCommit: Record<string, unknown> = { ...cycleCompleted() };
    delete withoutCommit.commit;
    expect(orderEventSchema.safeParse(withoutCommit).success).toBe(false);
  });

  it('rejects an event with a field the schema does not name', () => {
    expect(
      orderEventSchema.safeParse({ ...cancelled(), extra: 'x' }).success,
    ).toBe(false);
  });

  it('accepts free text of exactly 4 KiB', () => {
    expect(
      orderEventSchema.safeParse(cancelled({ reason: 'a'.repeat(4096) }))
        .success,
    ).toBe(true);
  });

  it('rejects free text one byte over 4 KiB', () => {
    expect(
      orderEventSchema.safeParse(cancelled({ reason: 'a'.repeat(4097) }))
        .success,
    ).toBe(false);
  });

  it('counts free text in UTF-8 bytes, not characters', () => {
    // 2049 characters of 2 bytes each: 4098 bytes, over the cap.
    expect(
      orderEventSchema.safeParse(cancelled({ reason: 'ż'.repeat(2049) }))
        .success,
    ).toBe(false);
  });

  it('rejects an inspection tail over 2 KiB', () => {
    const result = inspectionFinished({
      passed: false,
      results: [
        {
          command: 'pnpm test',
          exitCode: 1,
          timedOut: false,
          durationMs: 10,
          tail: 'a'.repeat(2049),
          logBlob: blobOf(6),
        },
      ],
    });
    expect(orderEventSchema.safeParse(result).success).toBe(false);
  });

  it('accepts an inspection tail of exactly 2 KiB', () => {
    const result = inspectionFinished({
      passed: false,
      results: [
        {
          command: 'pnpm test',
          exitCode: 1,
          timedOut: false,
          durationMs: 10,
          tail: 'a'.repeat(2048),
          logBlob: blobOf(6),
        },
      ],
    });
    expect(orderEventSchema.safeParse(result).success).toBe(true);
  });

  it('requires feedbackBlob for a failing verdict', () => {
    expect(
      orderEventSchema.safeParse(verdictRecorded({ pass: false })).success,
    ).toBe(false);
  });

  it('accepts a failing verdict that carries feedbackBlob', () => {
    expect(
      orderEventSchema.safeParse(
        verdictRecorded({ pass: false, feedbackBlob: blobOf(5) }),
      ).success,
    ).toBe(true);
  });

  it('requires handoverBlob for a block the operator reports', () => {
    const withoutHandover: Record<string, unknown> = { ...cycleBlocked() };
    delete withoutHandover.handoverBlob;
    expect(orderEventSchema.safeParse(withoutHandover).success).toBe(false);
  });

  it('accepts a runtime block without handoverBlob', () => {
    const runtime = cycleBlocked({
      source: 'runtime',
      reason: 'question_timeout',
      handoverBlob: undefined,
    });
    expect(orderEventSchema.safeParse(runtime).success).toBe(true);
  });

  it('accepts a failure with an infrastructure reason', () => {
    expect(
      orderEventSchema.safeParse(cycleFailed({ reason: 'lost' })).success,
    ).toBe(true);
  });

  it('rejects a failure with a reason outside the catalogue', () => {
    expect(
      orderEventSchema.safeParse(cycleFailed({ reason: 'exploded' as 'lost' }))
        .success,
    ).toBe(false);
  });

  it('accepts a note to a later station or to the supervisor', () => {
    expect(
      orderEventSchema.safeParse(noteLeft({ to: 'supervisor' })).success,
    ).toBe(true);
  });

  it('rejects an empty cycle id', () => {
    expect(
      orderEventSchema.safeParse({ ...cycleCompleted(), cycleId: '' }).success,
    ).toBe(false);
  });
});

describe('stored event envelope', () => {
  it('accepts a version 2 envelope', () => {
    const [stored] = history(created());
    expect(storedEventSchema.safeParse(stored).success).toBe(true);
  });

  it('rejects a version 1 envelope', () => {
    const [stored] = history(created());
    expect(
      storedEventSchema.safeParse({ ...stored, schemaVersion: 1 }).success,
    ).toBe(false);
  });

  it('rejects an envelope with a zero sequence number', () => {
    const [stored] = history(created());
    expect(storedEventSchema.safeParse({ ...stored, seq: 0 }).success).toBe(
      false,
    );
  });

  it('rejects an envelope with an actor of an unknown kind', () => {
    const [stored] = history(created());
    expect(
      storedEventSchema.safeParse({ ...stored, actor: { kind: 'robot' } })
        .success,
    ).toBe(false);
  });
});
