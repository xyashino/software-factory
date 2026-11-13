import { describe, expect, it } from 'vitest';
import { loadDefinitions } from '../../definitions/load';
import type { Definitions } from '../../definitions/types';
import { PACKAGE_ROOT } from '../../paths';
import { FakeClock } from '../../testing/fake-clock';
import { FakeStore } from '../../testing/fake-store';
import { formatDuration } from '../../format-duration';
import { boardRows, renderBoard } from '../board';
import { logLines } from '../log-view';
import { plainPaint, type Paint } from '../../paint';

const loaded = loadDefinitions(PACKAGE_ROOT);
if (!loaded.ok) throw new Error('shipped definitions must load');
const definitions: Definitions = loaded.value;

const plain = plainPaint;

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

const seeded = (): FakeStore => {
  const clock = new FakeClock(0);
  const store = new FakeStore(clock);
  store.createTask({
    taskId: 'hello',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  clock.set(1_000);
  store.append('hello', {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  store.append('hello', { type: 'setup_started' });
  store.append('hello', { type: 'setup_finished', ok: true, log: 'setup.log' });
  clock.set(2_000);
  store.append('hello', {
    type: 'attempt_started',
    attemptId: 'att-1',
    stepId: 'build',
    n: 1,
    snapshotRef: 'refs/software-factory/hello/build/att-1',
    artifacts: { report: '/r.md' },
  });
  store.append('hello', {
    type: 'agent_ready',
    attemptId: 'att-1',
    pane: 'p',
    tab: 't',
  });
  clock.set(62_000);
  return store;
};

describe('board projection', () => {
  it('shows the running step, attempt number and durations', () => {
    const rows = boardRows(seeded(), definitions, 62_000);
    expect(rows).toEqual([
      {
        taskId: 'hello',
        workflow: 'feature',
        status: 'running',
        step: 'build',
        stepLabel: 'build (Worker)',
        attempt: 1,
        retries: 0,
        attemptMs: 60_000,
        taskMs: 62_000,
        detail: undefined,
        question: undefined,
      },
    ]);
  });

  it('renders a table with the step and attempt', () => {
    const text = renderBoard(boardRows(seeded(), definitions, 62_000), plain);
    const [header, line] = text.split('\n');
    expect(header).toContain('TASK');
    expect(header).toContain('ATTEMPT TIME');
    expect(line).toContain('hello');
    expect(line).toContain('build (Worker)');
    expect(line).toContain('#1');
    expect(line).toContain('1m00s');
  });

  it('names the block reason under a blocked task', () => {
    const store = seeded();
    store.append('hello', {
      type: 'blocked',
      reason: 'retries_exhausted',
      detail: 'build failed 4 times',
    });
    const text = renderBoard(boardRows(store, definitions, 62_000), plain);
    expect(text).toContain('retries_exhausted: build failed 4 times');
  });

  it('paints a running task cyan', () => {
    const text = renderBoard(boardRows(seeded(), definitions, 62_000), tagged);
    expect(text.split('\n')[1]).toMatch(/^<cyan>hello .*<\/cyan>$/);
  });

  it('paints a blocked task red and a delivered task green', () => {
    const blocked = seeded();
    blocked.append('hello', { type: 'blocked', reason: 'infra', detail: 'x' });
    const delivered = seeded();
    delivered.append('hello', { type: 'delivered', prUrl: 'u' });
    const row = (store: FakeStore): string =>
      renderBoard(boardRows(store, definitions, 62_000), tagged).split(
        '\n',
      )[1] ?? '';
    expect(row(blocked)).toMatch(/^<red>hello /);
    expect(row(delivered)).toMatch(/^<green>hello /);
  });

  it('paints a non-zero retries cell yellow, padded to the column', () => {
    const base = boardRows(seeded(), definitions, 62_000)[0];
    if (base === undefined) throw new Error('seeded board has a row');
    const text = renderBoard([{ ...base, retries: 2 }], tagged);
    expect(text.split('\n')[1]).toContain('<yellow>2      </yellow>');
  });

  it('colours log event kinds and dims timestamps', () => {
    const store = seeded();
    store.append('hello', {
      type: 'question_asked',
      attemptId: 'att-1',
      questionId: 'q1',
      to: 'human',
      text: 'which db?',
    });
    store.append('hello', { type: 'blocked', reason: 'infra', detail: 'x' });
    const lines = logLines(store.events('hello'), tagged);
    expect(lines[0]).toMatch(
      /^<dim>[\d:.]+<\/dim> {2}<cyan>task_created {4}<\/cyan>/,
    );
    expect(lines.at(-2)).toContain('<yellow>question_asked');
    expect(lines.at(-1)).toContain('<red>blocked');
  });

  it('says so when there are no tasks', () => {
    expect(renderBoard([], plain)).toBe('no tasks yet');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(undefined)).toBe('-');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(185_000)).toBe('3m05s');
    expect(formatDuration(3_900_000)).toBe('1h05m');
  });
});

describe('event log view', () => {
  it('renders one line per event in order', () => {
    const lines = logLines(seeded().events('hello'));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3}\s+task_created\s+feature todos\/hello\.md$/,
    );
    expect(lines[3]).toContain('attempt_started');
    expect(lines[3]).toContain('build#1 att-1');
  });

  it('colours outcome summaries green, red and dim', () => {
    const store = seeded();
    store.append('hello', { type: 'verdict', attemptId: 'att-1', pass: true });
    store.append('hello', {
      type: 'verdict',
      attemptId: 'att-1',
      pass: false,
      feedbackPath: 'fb.md',
    });
    store.append('hello', {
      type: 'gate_finished',
      attemptId: 'att-1',
      passed: false,
      failures: [
        {
          command: 'pnpm test',
          exitCode: 1,
          timedOut: false,
          tail: '',
          logPath: 'gate.log',
        },
      ],
    });
    store.append('hello', {
      type: 'setup_finished',
      ok: false,
      log: 'setup.log',
    });

    const lines = logLines(store.events('hello'), tagged);

    expect(lines[2]).toContain('<green>ok</green>');
    expect(lines.at(-4)).toContain('<green>pass</green>');
    expect(lines.at(-3)).toContain('<red>fail</red> <dim>fb.md</dim>');
    expect(lines.at(-2)).toContain('<red>failed: pnpm test</red>');
    expect(lines.at(-1)).toContain('<red>failed (setup.log)</red>');
  });
});
