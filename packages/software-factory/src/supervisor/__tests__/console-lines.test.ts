import { describe, expect, it } from 'vitest';
import type { AttemptState, TaskState } from '../../engine/state';
import { reduce } from '../../engine/reduce';
import { describeStep } from '../../describe-step';
import {
  blockedText,
  commandResultText,
  commandStartText,
  consoleLine,
  deliveryText,
  heartbeatText,
  hintText,
  transitionLines,
} from '../console-lines';
import { definitions } from './fixtures';
import type { Paint } from '../../paint';
const tag =
  (name: string) =>
  (s: string): string =>
    `<${name}>${s}</${name}>`;

const tagged: Paint = {
  bold: tag('bold'),
  dim: tag('dim'),
  red: tag('red'),
  green: tag('green'),
  yellow: tag('yellow'),
  cyan: tag('cyan'),
  blue: tag('blue'),
  gray: tag('gray'),
  magenta: tag('magenta'),
};

const workflow = definitions.workflows.get('feature');
if (workflow === undefined) throw new Error('feature workflow must load');
const { roles } = definitions;

const empty: TaskState = reduce(workflow, []);

const attempt = (patch: Partial<AttemptState>): AttemptState => {
  return {
    attemptId: 'a1',
    stepId: 'build',
    n: 1,
    status: 'running',
    startedAt: 0,
    reminders: { idle: 0, silent: 0 },
    snapshotRef: 'ref',
    artifacts: {},
    failures: [],
    pausedMs: 0,
    ...patch,
  };
};

const withAttempts = (...attempts: AttemptState[]): TaskState => {
  return { ...empty, attempts, current: attempts.at(-1) };
};

const lines = (
  before: TaskState,
  after: TaskState,
  now = 252_000,
): string[] => {
  return transitionLines({
    before,
    after,
    workflow: workflow ?? never(),
    roles,
    taskId: 'hello',
    now,
  });
};

const never = (): never => {
  throw new Error('unreachable');
};

const hint = '[feature] next: sf status · sf log hello';

describe('console lines', () => {
  it('prints the step, role label, runner and model when an agent starts', () => {
    const description = describeStep(workflow ?? never(), roles, 'build');
    expect(description?.label).toBe('Worker');
    const [line, next] = lines(empty, withAttempts(attempt({})));
    expect(line).toMatch(
      /^\[feature\] ▶ build — Worker \(\S+\/\S+\), attempt 1$/,
    );
    expect(next).toBe(hint);
  });

  it('prints the label, runner and model when the operator starts', () => {
    const base = workflow ?? never();
    const worker = base.agents['worker'] ?? Object.values(base.agents)[0];
    if (worker === undefined) throw new Error('workflow needs an agent');
    const withOperator = { ...base, operator: worker };
    const [line, next] = transitionLines({
      before: empty,
      after: withAttempts(attempt({ attemptId: 'op1', stepId: 'operator' })),
      workflow: withOperator,
      roles,
      taskId: 'hello',
      now: 1_000,
    });
    expect(line).toMatch(
      /^\[feature\] ▶ operator — \S+ \(\S+\/\S+\), attempt 1$/,
    );
    expect(next).toBe(hint);
  });

  it('prints each gate command with its position and exit result', () => {
    expect(commandStartText('quality-gate', 'pnpm test', 1, 3)).toBe(
      '▶ quality-gate: pnpm test (1/3)',
    );
    expect(
      commandResultText('quality-gate', 'pnpm test', 1, 3, {
        exitCode: 0,
        timedOut: false,
      }),
    ).toBe('✓ quality-gate: pnpm test (1/3) exit 0');
    expect(
      commandResultText('quality-gate', 'pnpm test', 2, 3, {
        exitCode: 1,
        timedOut: false,
      }),
    ).toBe('✗ quality-gate: pnpm test (2/3) exit 1');
    expect(
      commandResultText('quality-gate', 'pnpm test', 3, 3, {
        exitCode: null,
        timedOut: true,
      }),
    ).toBe('✗ quality-gate: pnpm test (3/3) timed out');
  });

  it('prints a finished attempt with its duration', () => {
    const before = withAttempts(attempt({}));
    const after = withAttempts(
      attempt({ status: 'completed', outcome: 'done' }),
    );
    expect(lines(before, after)).toEqual(['[feature] ✓ build (4m12s)', hint]);
  });

  it('prints a passing gate and a passing verdict as success', () => {
    const gate = attempt({
      stepId: 'quality-gate',
      status: 'passed',
      outcome: 'gate_pass',
    });
    expect(lines(empty, withAttempts(gate))[0]).toBe(
      '[feature] ✓ quality-gate (4m12s)',
    );
    const verdict = attempt({
      stepId: 'audit',
      status: 'passed',
      outcome: 'verdict_pass',
    });
    expect(lines(empty, withAttempts(verdict)).at(-2)).toBe(
      '[feature] ✓ audit (4m12s)',
    );
  });

  it('prints a failing gate with its first failing command and the retry', () => {
    const failed = attempt({
      stepId: 'quality-gate',
      status: 'failed',
      outcome: 'gate_fail',
      failures: [
        {
          command: 'pnpm check-types',
          exitCode: 2,
          timedOut: false,
          tail: '',
          logPath: '0.log',
        },
      ],
    });
    const after: TaskState = {
      ...withAttempts(failed),
      retriesUsed: { 'quality-gate': 1 },
    };
    const max = workflow?.steps.find((s) => s.id === 'quality-gate')?.onFail
      ?.max;
    expect(lines(empty, after)[0]).toBe(
      `[feature] ✗ quality-gate: fail — pnpm check-types (retry 1/${max})`,
    );
  });

  it('prints a failing verdict with the feedback path and the retry', () => {
    const failed = attempt({
      stepId: 'audit',
      status: 'failed',
      outcome: 'verdict_fail',
      feedbackPath: '/ev/feedback.md',
    });
    const after: TaskState = {
      ...withAttempts(failed),
      retriesUsed: { audit: 1 },
    };
    const max = workflow?.steps.find((s) => s.id === 'audit')?.onFail?.max;
    expect(lines(empty, after).at(-2)).toBe(
      `[feature] ✗ audit: fail — /ev/feedback.md (retry 1/${max})`,
    );
  });

  it('prints a crashed attempt by its outcome', () => {
    const crashed = attempt({ status: 'failed', outcome: 'crashed' });
    expect(lines(empty, withAttempts(crashed)).at(-2)).toBe(
      '[feature] ✗ build: crashed',
    );
  });

  it('prints setup once it finishes', () => {
    expect(lines(empty, { ...empty, setupOk: true })[0]).toBe(
      '[feature] ✓ setup',
    );
    expect(lines(empty, { ...empty, setupOk: false })[0]).toBe(
      '[feature] ✗ setup failed',
    );
  });

  it('prints the delivery with the PR URL', () => {
    expect(deliveryText('https://example.test/pull/7')).toBe(
      '✓ delivered — https://example.test/pull/7',
    );
    const after: TaskState = {
      ...empty,
      delivered: { prUrl: 'https://example.test/pull/7' },
    };
    expect(lines(empty, after)).toEqual([
      '[feature] ✓ delivered — https://example.test/pull/7',
      hint,
    ]);
  });

  it('prints a block once with its reason', () => {
    const after: TaskState = {
      ...empty,
      block: { reason: 'infra', detail: 'disk full' },
    };
    expect(blockedText('infra', 'disk full')).toBe(
      '■ blocked (infra): disk full',
    );
    expect(lines(empty, after)[0]).toBe(
      '[feature] ■ blocked (infra): disk full',
    );
    expect(lines(after, after)).toEqual([]);
  });

  it('prints a heartbeat with elapsed time and time since output', () => {
    expect(heartbeatText('build', 252_000, 20_000)).toBe(
      'heartbeat: build working 4m12s, last output 20s ago',
    );
  });

  it('prints the sf hint on one line', () => {
    expect(hintText('standard-workflow')).toBe(
      'next: sf status · sf log standard-workflow',
    );
    expect(consoleLine('feature', hintText('hello'))).toBe(hint);
  });

  it('prints nothing when nothing changed', () => {
    const state = withAttempts(attempt({}));
    expect(lines(state, state)).toEqual([]);
  });
});

describe('coloured console lines', () => {
  const paintedLines = (before: TaskState, after: TaskState): string[] =>
    transitionLines({
      before,
      after,
      workflow: workflow ?? never(),
      roles,
      taskId: 'hello',
      now: 252_000,
      paint: tagged,
    });

  it('prints a finished step green and its hint dim', () => {
    const before = withAttempts(attempt({}));
    const after = withAttempts(
      attempt({ status: 'completed', outcome: 'done' }),
    );
    expect(paintedLines(before, after)).toEqual([
      '[feature] <green>✓ build (4m12s)</green>',
      '[feature] <dim>next: sf status · sf log hello</dim>',
    ]);
  });

  it('prints a failed step red', () => {
    const after = withAttempts(
      attempt({ status: 'failed', outcome: 'crashed' }),
    );
    expect(paintedLines(empty, after).at(-2)).toBe(
      '[feature] <red>✗ build: crashed</red>',
    );
  });

  it('prints a started agent cyan', () => {
    expect(paintedLines(empty, withAttempts(attempt({})))[0]).toMatch(
      /^\[feature\] <cyan>▶ build — /,
    );
  });

  it('prints a heartbeat dim and a gate command start cyan', () => {
    expect(heartbeatText('build', 1_000, 1_000, tagged)).toMatch(
      /^<dim>heartbeat: .*<\/dim>$/,
    );
    expect(commandStartText('gate', 'pnpm test', 1, 2, tagged)).toBe(
      '<cyan>▶ gate: pnpm test (1/2)</cyan>',
    );
  });

  it('prints a block red', () => {
    expect(blockedText('infra', 'down', tagged)).toBe(
      '<red>■ blocked (infra): down</red>',
    );
  });
});
