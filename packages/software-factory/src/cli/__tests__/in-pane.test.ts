import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadDefinitions } from '../../definitions/load';
import type { Definitions } from '../../definitions/types';
import { PACKAGE_ROOT } from '../../paths';
import { FakeClock } from '../../testing/fake-clock';
import { FakeStore } from '../../testing/fake-store';
import { CallerError, resolveCaller } from '../caller';
import { runDone } from '../commands/done';
import { runVerdict } from '../commands/verdict';

const loaded = loadDefinitions(PACKAGE_ROOT);
if (!loaded.ok) throw new Error('shipped definitions must load');
const definitions: Definitions = loaded.value;

let root: string;
let store: FakeStore;

const env = (taskId: string, attemptId: string): Record<string, string> => {
  return {
    FACTORY_ROOT: root,
    FACTORY_TASK: taskId,
    FACTORY_ATTEMPT: attemptId,
  };
};

/** Starts an attempt of `stepId` in the store and returns its evidence directory. */
const startAttempt = (
  taskId: string,
  attemptId: string,
  stepId: string,
  artifacts: Record<string, string>,
): void => {
  store.append(taskId, {
    type: 'attempt_started',
    attemptId,
    stepId,
    n: 1,
    snapshotRef: `refs/software-factory/${taskId}/${stepId}/${attemptId}`,
    artifacts,
  });
  store.append(taskId, { type: 'agent_ready', attemptId, pane: 'p', tab: 't' });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-pane-'));
  store = new FakeStore(new FakeClock(0));
  store.createTask({
    taskId: 'task-1',
    workflow: 'feature',
    todoPath: 'todos/x.md',
    branch: 'factory/task-1',
  });
  store.append('task-1', {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/x.md',
    branch: 'factory/task-1',
  });
  store.append('task-1', { type: 'setup_started' });
  store.append('task-1', {
    type: 'setup_finished',
    ok: true,
    log: 'setup.log',
  });
});

describe('caller identification', () => {
  it('refuses to run outside an agent pane', () => {
    expect(() => resolveCaller({}, store, definitions)).toThrow(CallerError);
  });

  it('refuses an attempt that is not running', () => {
    startAttempt('task-1', 'att-1', 'build', {
      report: join(root, 'r.md'),
      commit: join(root, 'c.txt'),
    });
    store.append('task-1', { type: 'completed', attemptId: 'att-1' });
    expect(() =>
      resolveCaller(env('task-1', 'att-1'), store, definitions),
    ).toThrow('is not running');
  });

  it('resolves the running attempt with its role', () => {
    startAttempt('task-1', 'att-1', 'build', {
      report: join(root, 'r.md'),
      commit: join(root, 'c.txt'),
    });
    const caller = resolveCaller(env('task-1', 'att-1'), store, definitions);
    expect(caller.role.id).toBe('worker');
    expect(caller.workflow.name).toBe('feature');
  });
});

describe('software-factory done', () => {
  it('lists missing artifacts and records nothing', () => {
    const dir = join(root, '.evidences', 'task-1', 'att-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), 'ok');
    startAttempt('task-1', 'att-1', 'build', {
      report: join(dir, 'report.md'),
      commit: join(dir, 'commit.txt'),
    });
    const caller = resolveCaller(env('task-1', 'att-1'), store, definitions);
    expect(runDone(caller)).toEqual({ ok: false, missing: ['commit.txt'] });
    expect(store.events('task-1').at(-1)?.event.type).toBe('agent_ready');
  });

  it('treats an empty artifact as missing', () => {
    const dir = join(root, 'e');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), '');
    writeFileSync(join(dir, 'commit.txt'), 'feat: x');
    startAttempt('task-1', 'att-1', 'build', {
      report: join(dir, 'report.md'),
      commit: join(dir, 'commit.txt'),
    });
    const caller = resolveCaller(env('task-1', 'att-1'), store, definitions);
    expect(runDone(caller)).toEqual({ ok: false, missing: ['report.md'] });
  });

  it('completes the attempt once every artifact is present', () => {
    const dir = join(root, 'ok');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), 'ok');
    writeFileSync(join(dir, 'commit.txt'), 'feat: x');
    startAttempt('task-1', 'att-1', 'build', {
      report: join(dir, 'report.md'),
      commit: join(dir, 'commit.txt'),
    });
    const caller = resolveCaller(env('task-1', 'att-1'), store, definitions);
    expect(runDone(caller)).toEqual({ ok: true });
    expect(store.events('task-1').at(-1)?.event).toEqual({
      type: 'completed',
      attemptId: 'att-1',
    });
  });

  it('refuses a judging role', () => {
    startAttempt('task-1', 'att-2', 'audit', { feedback: join(root, 'f.md') });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(() => runDone(caller)).toThrow('verdict');
  });
});

describe('software-factory verdict', () => {
  it('refuses fail without a non-empty feedback file', () => {
    const feedback = join(root, 'feedback.md');
    startAttempt('task-1', 'att-2', 'audit', { feedback });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(() => runVerdict(caller, 'fail')).toThrow('non-empty feedback');
    writeFileSync(feedback, '');
    expect(() => runVerdict(caller, 'fail')).toThrow('non-empty feedback');
  });

  it('records a failing verdict with its feedback path', () => {
    const feedback = join(root, 'feedback.md');
    writeFileSync(feedback, 'line 3: missing test');
    startAttempt('task-1', 'att-2', 'audit', { feedback });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(runVerdict(caller, 'fail')).toEqual({ feedbackPath: feedback });
    expect(store.events('task-1').at(-1)?.event).toEqual({
      type: 'verdict',
      attemptId: 'att-2',
      pass: false,
      feedbackPath: feedback,
    });
  });

  it('writes the feedback file itself from text given by a read-only judge', () => {
    const feedback = join(root, 'handed-over.md');
    startAttempt('task-1', 'att-2', 'audit', { feedback });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(runVerdict(caller, 'fail', 'src/a.ts:3 missing test\n')).toEqual({
      feedbackPath: feedback,
    });
    expect(readFileSync(feedback, 'utf8')).toBe('src/a.ts:3 missing test\n');
  });

  it('still refuses fail when the handed-over feedback is blank', () => {
    startAttempt('task-1', 'att-2', 'audit', {
      feedback: join(root, 'blank.md'),
    });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(() => runVerdict(caller, 'fail', '  \n')).toThrow(
      'non-empty feedback',
    );
  });

  it('records a passing verdict without requiring feedback', () => {
    startAttempt('task-1', 'att-2', 'audit', {
      feedback: join(root, 'missing.md'),
    });
    const caller = resolveCaller(env('task-1', 'att-2'), store, definitions);
    expect(runVerdict(caller, 'pass')).toEqual({ feedbackPath: undefined });
    expect(store.events('task-1').at(-1)?.event).toEqual({
      type: 'verdict',
      attemptId: 'att-2',
      pass: true,
    });
  });

  it('refuses a non-judging role', () => {
    startAttempt('task-1', 'att-1', 'build', {
      report: join(root, 'r.md'),
      commit: join(root, 'c.txt'),
    });
    const caller = resolveCaller(env('task-1', 'att-1'), store, definitions);
    expect(() => runVerdict(caller, 'pass')).toThrow('does not judge');
  });
});
