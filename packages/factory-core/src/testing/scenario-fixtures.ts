import type { LineSnapshot } from '../line/snapshot';
import type { StoredEvent } from '../order/events';
import { makeLine } from './event-builders';
import { lineBuilder } from './line-builder';
import { type Intent, type Run, runSequence } from './runner';

/**
 * Named Traveler fixtures from the v2-04 scenarios (`order/__tests__/scenarios.*`). Each is an
 * intent sequence run on a Line, so a fixture is data, and the events it produces are the history a
 * store must rebuild identically (STORAGE §6).
 */
export interface ScenarioFixture {
  name: string;
  line: LineSnapshot;
  intents: Intent[];
}

const PASS = { kind: 'finish', pass: true, commit: 2 } as const;

const DEFAULT = makeLine();

/** plan, build, audit (a verdict), check (an inspection), then deliver. */
const DELIVERED: Intent[] = [
  { kind: 'start', goodBase: true, commit: 1 },
  PASS,
  { kind: 'start', goodBase: true, commit: 2 },
  PASS,
  { kind: 'start', goodBase: true, commit: 3 },
  PASS,
  { kind: 'start', goodBase: true, commit: 4 },
  PASS,
  { kind: 'finish', pass: true, commit: 5 },
];

const TWO_STATIONS = lineBuilder().operator('plan').operator('build').build();

export const SCENARIO_FIXTURES: ScenarioFixture[] = [
  {
    name: 'delivers on the default line',
    line: DEFAULT,
    intents: DELIVERED,
  },
  {
    name: 'delivers on a two-station line',
    line: TWO_STATIONS,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      PASS,
      { kind: 'start', goodBase: true, commit: 2 },
      PASS,
    ],
  },
  {
    name: 'retries after a failed cycle, then raises an Andon',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      { kind: 'fail', reason: 'crashed' },
      { kind: 'start', goodBase: true, commit: 2 },
      { kind: 'fail', reason: 'timed_out' },
      { kind: 'start', goodBase: true, commit: 3 },
      { kind: 'fail', reason: 'stalled' },
    ],
  },
  {
    name: 'asks a question, is answered, and the cycle resumes',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      { kind: 'ask' },
      { kind: 'answer' },
      { kind: 'note' },
      PASS,
    ],
  },
  {
    name: 'blocks, then the Supervisor resumes with a retry',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      { kind: 'block' },
      { kind: 'resume', grant: 1 },
    ],
  },
  {
    name: 'hands a cycle over and continues from its commit',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      { kind: 'handover', commit: 2 },
      PASS,
    ],
  },
  {
    name: 'restarts from an earlier station after a block',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      PASS,
      { kind: 'start', goodBase: true, commit: 2 },
      { kind: 'block' },
      { kind: 'resume', restartTo: 0 },
    ],
  },
  {
    name: 'reopens a delivered order on build while its PR is open',
    line: DEFAULT,
    intents: [
      ...DELIVERED,
      { kind: 'pr', state: 'open' },
      { kind: 'reopen', station: 1 },
    ],
  },
  {
    name: 'cancels while a question is open',
    line: DEFAULT,
    intents: [
      { kind: 'start', goodBase: true, commit: 1 },
      { kind: 'ask' },
      { kind: 'cancel' },
    ],
  },
];

/** The events a fixture produces when its intents run. */
export const fixtureEvents = (fixture: ScenarioFixture): StoredEvent[] =>
  runSequence(fixture.line, fixture.intents).events;

/** The full run of a fixture, with the trace of what each intent did. */
export const fixtureRun = (fixture: ScenarioFixture): Run =>
  runSequence(fixture.line, fixture.intents);
