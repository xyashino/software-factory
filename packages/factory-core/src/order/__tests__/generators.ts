import fc from 'fast-check';
import type { LineSnapshot } from '../../line/snapshot';
import { lineBuilder } from '../../testing/line-builder';
import type { Intent } from './runner';

/** One Station of a generated Line. A retry always names an earlier Station (CORE §4.1). */
interface StationShape {
  inspection: boolean;
  verdict: boolean;
  producesArtifact: boolean;
  retryTo: number | undefined;
  max: number;
  maxRestarts: number;
  maxLostRestarts: number;
}

const stationShape: fc.Arbitrary<StationShape> = fc.record({
  inspection: fc.boolean(),
  verdict: fc.boolean(),
  producesArtifact: fc.boolean(),
  retryTo: fc.option(fc.nat({ max: 5 }), { nil: undefined }),
  max: fc.integer({ min: 0, max: 3 }),
  maxRestarts: fc.integer({ min: 0, max: 2 }),
  maxLostRestarts: fc.integer({ min: 0, max: 3 }),
});

/** A Line of 1 to 6 Stations: operators, inspections, verdicts, retries and budgets all vary. */
export const arbLine: fc.Arbitrary<LineSnapshot> = fc
  .array(stationShape, { minLength: 1, maxLength: 6 })
  .map((drawn) => {
    // A Line needs an operator Station: only operators commit the work that delivery builds on.
    const shapes = drawn.some((shape) => !shape.inspection)
      ? drawn
      : drawn.map((shape, index) =>
          index === 0 ? { ...shape, inspection: false } : shape,
        );
    const builder = lineBuilder();
    shapes.forEach((shape, index) => {
      const id = `s${index}`;
      const onFail =
        shape.retryTo !== undefined && index > 0
          ? { retry: `s${shape.retryTo % index}`, max: shape.max }
          : undefined;
      const artifacts = shape.producesArtifact ? ['out'] : [];
      if (shape.inspection) {
        builder.inspection(id, {
          maxRestarts: shape.maxRestarts,
          maxLostRestarts: shape.maxLostRestarts,
          ...(onFail ? { onFail } : {}),
        });
      } else {
        builder.operator(id, {
          artifacts,
          verdict: shape.verdict,
          maxRestarts: shape.maxRestarts,
          maxLostRestarts: shape.maxLostRestarts,
          ...(onFail ? { onFail } : {}),
        });
      }
    });
    return builder.build();
  });

const commit = fc.integer({ min: 1, max: 40 });
const restartTo = fc.option(fc.nat({ max: 5 }), { nil: undefined });
const grant = fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined });

/** Intents that need a Supervisor. Property I11 leaves them out: it bounds machine loss alone. */
const supervisorIntents: fc.Arbitrary<Intent>[] = [
  fc.record({ kind: fc.constant('resume' as const), restartTo, grant }),
  fc.record({
    kind: fc.constant('reopen' as const),
    station: fc.nat({ max: 5 }),
  }),
];

/** Weighted intents. Most are the happy path; the rest are failures, late facts and wrong commands. */
const weightedIntents = (withSupervisor: boolean) => {
  // Weights are integers. The happy path (claim, start, finish) is the most likely step, failures
  // and Supervisor commands are common enough to reach Andons, and cancel is rare: it ends the run.
  const weighted: { weight: number; arbitrary: fc.Arbitrary<Intent> }[] = [
    { weight: 40, arbitrary: fc.constant({ kind: 'claim' }) },
    {
      weight: 50,
      arbitrary: fc.record({
        kind: fc.constant('start' as const),
        goodBase: fc.constantFrom(true, true, true, false),
        commit,
      }),
    },
    {
      weight: 120,
      arbitrary: fc.record({
        kind: fc.constant('finish' as const),
        pass: fc.constantFrom(true, true, true, true, true, true, false),
        commit,
      }),
    },
    {
      weight: 8,
      arbitrary: fc.record({
        kind: fc.constant('fail' as const),
        reason: fc.constantFrom(
          'timed_out' as const,
          'crashed' as const,
          'stalled' as const,
          'start_failed' as const,
          'lost' as const,
        ),
      }),
    },
    { weight: 2, arbitrary: fc.constant({ kind: 'block' }) },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant('handover' as const), commit }),
    },
    { weight: 6, arbitrary: fc.constant({ kind: 'ask' }) },
    { weight: 5, arbitrary: fc.constant({ kind: 'answer' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'note' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'nudge' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'usage' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'expire' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'release' }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'workspace' }) },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('pr' as const),
        state: fc.constantFrom(
          'open' as const,
          'merged' as const,
          'closed' as const,
        ),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'cancel' }) },
    {
      weight: 4,
      arbitrary: fc.record({ kind: fc.constant('stale' as const), commit }),
    },
  ];
  if (withSupervisor) {
    weighted.push(
      { weight: 10, arbitrary: supervisorIntents[0] as fc.Arbitrary<Intent> },
      { weight: 4, arbitrary: supervisorIntents[1] as fc.Arbitrary<Intent> },
    );
  }
  return weighted;
};

/**
 * A command sequence of 8 to 60 intents. The minimum is high on purpose: fast-check's default size
 * draws short arrays, and a short sequence never reaches delivery or an Andon. Shrinks as data.
 */
export const arbIntents = (
  options: { withSupervisor: boolean } = { withSupervisor: true },
): fc.Arbitrary<Intent[]> =>
  fc.array(fc.oneof(...weightedIntents(options.withSupervisor)), {
    minLength: 8,
    maxLength: 60,
  });
