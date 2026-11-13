import type { CycleId } from '../../ids';
import type { LineSnapshot } from '../../line/snapshot';
import {
  blobOf,
  commitOf,
  created,
  PR_URL,
  pinnedLineOf,
  stationOf,
  workerIdOf,
} from '../../testing/event-builders';
import { actors, given, type Scenario } from '../../testing/harness';
import type { OrderCommand } from '../commands';
import type { Actor, StoredEvent } from '../events';
import { evolve } from '../evolve';
import { nextJob } from '../next-job';
import type { WorkOrderState } from '../state';
import { raiseAndon } from './steps';

/**
 * One step a generated sequence takes. Plain data, so a failing sequence shrinks and prints. The
 * runner turns each intent into the command the current state allows; when the state allows none,
 * the intent is skipped. Some intents are deliberately wrong (a stale epoch, a bad base commit).
 */
export type Intent =
  | { kind: 'claim' }
  | { kind: 'start'; goodBase: boolean; commit: number }
  | { kind: 'finish'; pass: boolean; commit: number }
  | {
      kind: 'fail';
      reason: 'timed_out' | 'crashed' | 'stalled' | 'start_failed' | 'lost';
    }
  | { kind: 'block' }
  | { kind: 'handover'; commit: number }
  | { kind: 'ask' }
  | { kind: 'answer' }
  | { kind: 'note' }
  | { kind: 'nudge' }
  | { kind: 'usage' }
  | { kind: 'expire' }
  | { kind: 'release' }
  | { kind: 'workspace' }
  | { kind: 'resume'; restartTo?: number; grant?: number }
  | { kind: 'reopen'; station: number }
  | { kind: 'pr'; state: 'open' | 'merged' | 'closed' }
  | { kind: 'cancel' }
  | { kind: 'stale'; commit: number };

export interface Run {
  /** Every stored event, in order: the Traveler the sequence produced. */
  events: StoredEvent[];
  /** How many intents the state allowed, and how many were refused or had no command. */
  accepted: number;
  skipped: number;
  /** What happened to each intent: `kind:ok`, `kind:refused(code)` or `kind:no-command`. */
  trace: string[];
}

const SUPERVISOR = actors.supervisor('dev');
const FACTORY: Actor = { kind: 'factory' };

/** A command the state allows, with the actor that must send it and the epoch it claims. */
interface Planned {
  command: OrderCommand;
  by: Actor;
  epoch?: number;
}

/** The commands the state allows for an intent, each with the actor that must send it. */
const commandFor = (
  intent: Intent,
  state: WorkOrderState,
): Planned | undefined => {
  const job = state.activeJob;
  const cycleOf = (): CycleId | undefined => job?.cycleId;
  const started = (): CycleId | undefined => {
    const id = cycleOf();
    return id && state.cycles.some((cycle) => cycle.cycleId === id)
      ? id
      : undefined;
  };
  const stationOfJob = () => {
    const pending = nextJob({ ...state, activeJob: undefined });
    return pending.kind === 'job' && pending.job.kind !== 'deliver'
      ? pending.job
      : undefined;
  };
  const worker = actors.worker(1);

  switch (intent.kind) {
    case 'claim':
      if (
        job ||
        state.phase.kind === 'delivered' ||
        state.phase.kind === 'cancelled'
      )
        return undefined;
      return {
        command: { type: 'ClaimJob', workerId: workerIdOf(1) },
        by: FACTORY,
      };
    case 'start': {
      const cycle = cycleOf();
      if (!job || !cycle || started()) return undefined;
      const pending = nextJob({ ...state, activeJob: undefined });
      const base =
        pending.kind === 'job' &&
        pending.job.kind !== 'deliver' &&
        pending.job.base !== 'branch_base'
          ? pending.job.base
          : commitOf(intent.commit);
      return {
        command: {
          type: 'StartCycle',
          baseCommit: intent.goodBase ? base : commitOf(intent.commit),
        },
        by: worker,
      };
    }
    case 'finish': {
      if (!job) return undefined;
      if (job.kind === 'deliver') {
        return {
          command: intent.pass
            ? {
                type: 'ReportDelivery',
                result: {
                  status: 'finished',
                  prUrl: PR_URL,
                  commit: commitOf(intent.commit),
                },
              }
            : {
                type: 'ReportDelivery',
                result: { status: 'failed', detail: 'push was rejected' },
              },
          by: worker,
        };
      }
      const cycle = started();
      if (!cycle) return undefined;
      if (job.kind === 'run_inspection') {
        return {
          command: {
            type: 'ReportInspection',
            cycleId: cycle,
            passed: intent.pass,
            results: [],
          },
          by: worker,
        };
      }
      const station = state.line.stations.find(
        (candidate) => candidate.id === stationOfJob()?.stationId,
      );
      if (!station) return undefined;
      const operator = actors.operator(cycle);
      if (station.verdict) {
        return {
          command: {
            type: 'SubmitVerdict',
            cycleId: cycle,
            pass: intent.pass,
            artifacts: {},
            feedbackBlob: intent.pass ? undefined : blobOf(5),
            commit: intent.pass ? commitOf(intent.commit) : undefined,
          },
          by: operator,
        };
      }
      if (!intent.pass) {
        return {
          command: {
            type: 'FailCycle',
            cycleId: cycle,
            reason: 'crashed',
            detail: 'the Operator crashed',
          },
          by: worker,
        };
      }
      return {
        command: {
          type: 'CompleteCycle',
          cycleId: cycle,
          artifacts: Object.fromEntries(
            station.artifacts.map((key) => [key, blobOf(7)]),
          ),
          commit: commitOf(intent.commit),
        },
        by: operator,
      };
    }
    case 'fail': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'FailCycle',
              cycleId: cycle,
              reason: intent.reason,
              detail: intent.reason,
            },
            by: worker,
          }
        : undefined;
    }
    case 'block': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'BlockCycle',
              cycleId: cycle,
              source: 'operator',
              reason: 'operator_reported',
              detail: 'needs a decision',
              handoverBlob: blobOf(4),
            },
            by: actors.operator(cycle),
          }
        : undefined;
    }
    case 'handover': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'HandOverCycle',
              cycleId: cycle,
              handoverBlob: blobOf(4),
              commit: commitOf(intent.commit),
            },
            by: worker,
          }
        : undefined;
    }
    case 'ask': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'AskQuestion',
              cycleId: cycle,
              text: 'Which table?',
            },
            by: actors.operator(cycle),
          }
        : undefined;
    }
    case 'answer': {
      const open = [...state.questions]
        .reverse()
        .find((question) => question.status !== 'answered');
      return open
        ? {
            command: {
              type: 'Answer',
              questionId: open.questionId,
              text: 'the orders table',
            },
            by: SUPERVISOR,
          }
        : undefined;
    }
    case 'note': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'LeaveNote',
              cycleId: cycle,
              to: 'supervisor',
              text: 'a note',
            },
            by: actors.operator(cycle),
          }
        : undefined;
    }
    case 'nudge':
      return { command: { type: 'Nudge', text: 'focus' }, by: SUPERVISOR };
    case 'usage': {
      const cycle = started();
      return cycle
        ? {
            command: {
              type: 'RecordUsage',
              cycleId: cycle,
              model: 'claude',
              inputTokens: 1,
              outputTokens: 2,
            },
            by: worker,
          }
        : undefined;
    }
    case 'expire':
      return job
        ? { command: { type: 'ExpireLease' }, by: FACTORY }
        : undefined;
    case 'release':
      return job ? { command: { type: 'ReleaseJob' }, by: worker } : undefined;
    case 'workspace':
      return job && !started()
        ? {
            command: {
              type: 'ReportWorkspaceFailed',
              stage: 'worktree',
              detail: 'no worktree',
              logBlob: blobOf(7),
            },
            by: worker,
          }
        : undefined;
    case 'resume': {
      const restart =
        intent.restartTo === undefined
          ? undefined
          : state.line.stations[intent.restartTo];
      const mode = restart
        ? { kind: 'restart_from' as const, stationId: stationOf(restart.id) }
        : { kind: 'retry_station' as const };
      return {
        command: { type: 'Resume', mode, grantRetries: intent.grant },
        by: SUPERVISOR,
      };
    }
    case 'reopen': {
      const station = state.line.stations[intent.station];
      return station
        ? {
            command: { type: 'Reopen', stationId: stationOf(station.id) },
            by: SUPERVISOR,
          }
        : undefined;
    }
    case 'pr':
      return {
        command: { type: 'RecordPrState', prUrl: PR_URL, state: intent.state },
        by: FACTORY,
      };
    case 'cancel':
      return {
        command: { type: 'Cancel', reason: 'superseded by a newer todo' },
        by: SUPERVISOR,
      };
    case 'stale': {
      // A Worker that lost its lease claims the epoch before the active one: decide must refuse it.
      const cycle = started();
      if (!cycle || !job) return undefined;
      return {
        command: {
          type: 'FailCycle',
          cycleId: cycle,
          reason: 'crashed',
          detail: 'late',
        },
        by: worker,
        epoch: job.epoch - 1,
      };
    }
  }
};

/**
 * Runs `intents` against a Work order of `line`: each allowed command is applied, and after each
 * one the Factory raises the Andon that `nextJob` asks for (CORE §5.3). Refused commands are
 * skipped. Pure apart from the fakes: the same intents give the same events.
 */
export const runSequence = (
  line: LineSnapshot,
  intents: readonly Intent[],
): Run => {
  const scenario: Scenario = given([]);
  scenario
    .when(
      { ...created({ line: pinnedLineOf(line) }), type: 'CreateOrder' },
      { kind: 'factory' },
    )
    .apply();

  let accepted = 0;
  let skipped = 0;
  const trace: string[] = [];

  /** Sends a planned command; true when the state accepted it. The Factory raises any Andon. */
  const send = (planned: Planned, label: string): boolean => {
    const outcome = scenario.when(planned.command, planned.by, {
      epoch: planned.epoch,
    });
    const refusal = outcome.refusal();
    if (refusal) {
      trace.push(`${label}:refused(${refusal.code})`);
      return false;
    }
    trace.push(`${label}:ok`);
    outcome.apply();
    const after = scenario.state();
    if (after && nextJob(after).kind === 'raise_andon') {
      raiseAndon(scenario);
    }
    return true;
  };

  for (const intent of intents) {
    let state = scenario.state();
    if (!state) break;
    let planned = commandFor(intent, state);
    if (!planned) {
      // A worker claims and starts before it finishes, so the intent first takes the step it needs.
      const step = prerequisite(intent, state);
      if (step && send(step, `${step.label}(auto)`)) {
        accepted += 1;
        state = scenario.state();
        planned = state ? commandFor(intent, state) : undefined;
      }
    }
    if (!planned) {
      skipped += 1;
      trace.push(`${intent.kind}:no-command`);
      continue;
    }
    if (send(planned, intent.kind)) {
      accepted += 1;
    } else {
      skipped += 1;
    }
  }
  return { events: scenario.events(), accepted, skipped, trace };
};

/** The step an intent needs first: a claim for a Cycle intent, a start for an intent on a Cycle. */
const prerequisite = (
  intent: Intent,
  state: WorkOrderState,
): (Planned & { label: string }) | undefined => {
  const needsJob = [
    'finish',
    'fail',
    'block',
    'handover',
    'ask',
    'note',
    'usage',
    'stale',
    'start',
    'workspace',
    'expire',
    'release',
  ];
  const needsCycle = [
    'finish',
    'fail',
    'block',
    'handover',
    'ask',
    'note',
    'usage',
    'stale',
  ];
  if (!needsJob.includes(intent.kind)) return undefined;
  const job = state.activeJob;
  if (!job) {
    const claim = commandFor({ kind: 'claim' }, state);
    return claim ? { ...claim, label: 'claim' } : undefined;
  }
  const started =
    job.cycleId !== undefined &&
    state.cycles.some((cycle) => cycle.cycleId === job.cycleId);
  if (!started && job.kind !== 'deliver' && needsCycle.includes(intent.kind)) {
    const start = commandFor(
      { kind: 'start', goodBase: true, commit: 1 },
      state,
    );
    return start ? { ...start, label: 'start' } : undefined;
  }
  return undefined;
};

/** The state after each stored event: states[k] folds events[0..k]. */
export const foldEach = (events: readonly StoredEvent[]): WorkOrderState[] => {
  const states: WorkOrderState[] = [];
  let state: WorkOrderState | undefined;
  for (const stored of events) {
    state = evolve(state, stored);
    states.push(state);
  }
  return states;
};
