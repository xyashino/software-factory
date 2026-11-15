import { describe, expect, it } from 'vitest';
import { resolveCycleContext } from '@repo/factory-core/order/context';
import { foldHistory } from '../../state';
import { buildPrompt, type PromptInput } from '../build-prompt';
import { MissingVariableError, renderTemplate } from '../render';
import {
  createOrder,
  shippedDefinitions,
  world,
} from '../../__tests__/test-kit';
import type { BlobRef, StationId } from '@repo/factory-core/ids';
import type { CycleInput } from '@repo/factory-core/order/context';

/** Absolute paths of the machine a prompt was built on: none may reach a Job (PROTOCOL §4). */
const ABSOLUTE_PATH =
  /(^|[\s"'`(=])(\/home\/|\/tmp\/|\/Users\/|\/var\/|\/etc\/|[A-Za-z]:[\\/])/;

const LINES = ['feature', 'standard', 'fast'];

/** The Prompt input of the first Cycle of a Station on a fresh Work order of the given Line. */
const firstCycleInput = async (
  lineName: string,
  stationId: string,
): Promise<PromptInput> => {
  const definitions = shippedDefinitions();
  const w = world();
  const orderId = await createOrder(w, {
    todoId: `todo-${lineName}-${stationId}`,
    line: lineName,
  });
  const state = foldHistory(await w.events.load(orderId));
  if (!state) throw new Error('order has no state');
  const loaded = definitions.lines.get(lineName);
  const station = loaded?.line.stations.find(
    (candidate) => candidate.id === stationId,
  );
  if (!loaded || !station || station.kind !== 'operator')
    throw new Error('not an operator station');
  const pool = loaded.line.operators[station.operator];
  const profile = pool ? definitions.operators.get(pool.profile) : undefined;
  if (!profile) throw new Error('no profile');
  const context = resolveCycleContext(state, stationId as StationId, {
    kind: 'first',
  });
  const bodyText = `Body of todo-${lineName}-${stationId}`;
  const blobs = new Map<BlobRef, string>([[state.spec.bodyBlob, bodyText]]);
  return {
    profile,
    templates: definitions.templates,
    todoId: state.todoId,
    cycleId: 'C000000000000000000000000A',
    todoBody: bodyText,
    context,
    blobSizes: new Map(
      context.inputs.flatMap((item: CycleInput) =>
        item.kind === 'artifact' ||
        (item.kind === 'order' && item.field === 'body')
          ? [[item.blob, 100] as const]
          : [],
      ),
    ),
    blobTexts: blobs,
    budget: { retry: 0, max: 0 },
    declared: { rules: profile.rules, skills: profile.skills },
    operatorCommands: ['factory-operator done'],
  };
};

describe('prompt snapshots per Line Station', () => {
  for (const lineName of LINES) {
    const line = shippedDefinitions().lines.get(lineName)?.line;
    for (const station of line?.stations ?? []) {
      if (station.kind !== 'operator') continue;
      it(`renders ${lineName}/${station.id} with no absolute path`, async () => {
        const input = await firstCycleInput(lineName, station.id);

        const text = buildPrompt(input);

        expect(text).not.toMatch(ABSOLUTE_PATH);
        expect(text).toMatchSnapshot();
      });
    }
  }
});

describe('prompt rules', () => {
  it('refuses to render a placeholder that has no value', () => {
    expect(() => renderTemplate('needs {{taskId}}', {})).toThrow(
      MissingVariableError,
    );
  });

  it('lists only the gate commands that failed or timed out, with a run-and-fix instruction and no raw log', async () => {
    const input = await firstCycleInput('feature', 'plan');
    const passLog = `\u001b[32mPASS-LOG-TEXT\u001b[0m\n`;
    const failLog = `\u001b[31mFAIL-LOG-TEXT\u001b[0m\n${'x'.repeat(13_000)}`;
    const timeoutLog = 'TIMEOUT-LOG-TEXT\n';
    const passRef = `sha256:${'1'.repeat(64)}` as BlobRef;
    const failRef = `sha256:${'2'.repeat(64)}` as BlobRef;
    const timeoutRef = `sha256:${'3'.repeat(64)}` as BlobRef;

    const text = buildPrompt({
      ...input,
      context: {
        ...input.context,
        feedback: {
          kind: 'inspection',
          fromCycle: 'C000000000000000000000000A' as never,
          results: [
            {
              command: 'gate-passing-check',
              exitCode: 0,
              timedOut: false,
              durationMs: 10,
              tail: 'passed',
              logBlob: passRef,
            },
            {
              command: 'gate-failing-check',
              exitCode: 1,
              timedOut: false,
              durationMs: 10,
              tail: 'failed (exit 1)',
              logBlob: failRef,
            },
            {
              command: 'gate-slow-check',
              exitCode: null,
              timedOut: true,
              durationMs: 300,
              tail: 'timed out',
              logBlob: timeoutRef,
            },
          ],
          logBlobs: [passRef, failRef, timeoutRef],
        },
      },
      blobTexts: new Map([
        [passRef, passLog],
        [failRef, failLog],
        [timeoutRef, timeoutLog],
      ]),
    });

    expect(text).not.toContain('gate-passing-check');
    expect(text).toContain('`gate-failing-check` (failed (exit 1))');
    expect(text).toContain('`gate-slow-check` (timed out)');
    expect(text.split('Quality gate check did not pass').length - 1).toBe(2);
    expect(text).toContain('Run it in your worktree');
    expect(text).toContain('fix them');
    expect(text).not.toContain('PASS-LOG-TEXT');
    expect(text).not.toContain('FAIL-LOG-TEXT');
    expect(text).not.toContain('TIMEOUT-LOG-TEXT');
    expect(text).not.toContain('xxxxxxxxxx');
    expect(text).not.toContain('\u001b');
  });
});
