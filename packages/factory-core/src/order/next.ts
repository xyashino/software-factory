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
  | { kind: 'deliver'; base: CommitSha }
  | { kind: 'mechanic'; andonAt: number; n: number } // no workspace; the Mechanic triages the Andon (CORE §14.4)
  | { kind: 'publish_blocked'; andonAt: number }; // the Cell publishes a draft `[BLOCKED]` PR for the Andon (v1 publishBlockedWork)

export type Next =
  | { kind: 'done' }
  | { kind: 'busy' } // a job is active
  | { kind: 'await_supervisor'; cause: 'andon' }
  | { kind: 'raise_andon'; reason: AndonReason; detail: string } // the Factory appends andon_raised
  | { kind: 'escalate_andon' } // transient: the Factory records the escalation as an incident (CORE §14.4)
  | { kind: 'job'; job: JobSpec };

/** A job of a Station: it runs a Cycle. A deliver or a Mechanic job runs none. */
export const isStationJob = (
  job: JobSpec,
): job is Extract<JobSpec, { stationId: StationId }> =>
  job.kind === 'run_operator_station' || job.kind === 'run_inspection';

/** Mechanic jobs one Work order may spend on its Andons, lost ones included (CORE §14.4). */
export const MECHANIC_BUDGET = 2;
