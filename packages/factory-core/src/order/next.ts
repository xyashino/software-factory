import type { CommitSha, StationId } from '../ids';
import type { AndonReason, CycleCause } from './events';

/**
 * Types of CORE §6 (`nextJob`). The function itself is a later todo; the projection only needs the
 * shapes, so they live here and `toProjection` takes a `Next` as input.
 */
export type JobSpec =
  | {
      kind: 'run_operator_station';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
    }
  | {
      kind: 'run_inspection';
      stationId: StationId;
      n: number;
      cause: CycleCause;
      base: CommitSha | 'branch_base';
    }
  | { kind: 'deliver'; base: CommitSha };

export type Next =
  | { kind: 'done' }
  | { kind: 'busy' } // a job is active
  | { kind: 'await_supervisor'; cause: 'andon' }
  | { kind: 'raise_andon'; reason: AndonReason; detail: string } // the Factory appends andon_raised
  | { kind: 'job'; job: JobSpec };
