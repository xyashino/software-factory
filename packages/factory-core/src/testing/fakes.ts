import type { Clock } from '../ports/clock';
import type { Ids } from '../ports/ids';
import type { BlobRef, CycleId, JobId, QuestionId, ResumeId } from '../ids';

/** A clock the test moves by hand. Starts at `start` milliseconds. */
export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export const fakeClock = (start = 0): FakeClock => {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
};

/**
 * Deterministic ids: each kind counts from 1 in ULID shape. `next()` is the id source the core's
 * `decide` reads (CORE §5.1); the typed methods satisfy the `Ids` port.
 */
export interface FakeIds extends Ids {
  next(): string;
}

const ulid = (letter: string, n: number): string =>
  letter + n.toString().padStart(25, '0');

export const fakeIds = (): FakeIds => {
  const counters = { job: 0, cycle: 0, resume: 0, question: 0, next: 0 };
  return {
    jobId: () => {
      counters.job += 1;
      return ulid('J', counters.job) as JobId;
    },
    cycleId: () => {
      counters.cycle += 1;
      return ulid('C', counters.cycle) as CycleId;
    },
    resumeId: () => {
      counters.resume += 1;
      return ulid('R', counters.resume) as ResumeId;
    },
    questionId: () => {
      counters.question += 1;
      return ulid('Q', counters.question) as QuestionId;
    },
    next: () => {
      counters.next += 1;
      return ulid('D', counters.next);
    },
  };
};

/** The blobs a decision may cite. Every blob exists and is 100 bytes unless listed otherwise. */
export interface FakeBlobs {
  exists(ref: BlobRef): boolean;
  size(ref: BlobRef): number;
  /** Refs that do not exist in the store, so a command citing them is refused. */
  missing(...refs: BlobRef[]): FakeBlobs;
}

export const fakeBlobs = (): FakeBlobs => {
  const absent = new Set<string>();
  const blobs: FakeBlobs = {
    exists: (ref) => !absent.has(ref),
    size: (ref) => (absent.has(ref) ? 0 : 100),
    missing: (...refs) => {
      for (const ref of refs) absent.add(ref);
      return blobs;
    },
  };
  return blobs;
};
