import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryEvent } from '../engine/events';
import type { StorePort } from '../ports/store.port';
import type { FakeClock } from './fake-clock';

export interface StoreHarness {
  store: StorePort;
  clock: FakeClock;
  dispose(): void;
}

const newTask = {
  taskId: 'task-a',
  workflow: 'feature',
  todoPath: 'todos/a.md',
  branch: 'feat/a',
};

const started: FactoryEvent = {
  type: 'attempt_started',
  attemptId: 'plan-1',
  stepId: 'plan',
  n: 1,
  snapshotRef: 'snap-1',
  artifacts: { plan: '/evidence/plan-1/plan.md' },
};

/**
 * The behaviour every store must share. Each store runs this suite, so the
 * in-memory fake and the SQLite adapter cannot drift apart.
 */
export const defineStoreContract = (
  name: string,
  create: () => StoreHarness,
): void => {
  describe(`${name} store contract`, () => {
    let harness: StoreHarness;

    beforeEach(() => {
      harness = create();
    });

    afterEach(() => {
      harness.dispose();
    });

    it('starts a created task in setting_up', () => {
      harness.store.createTask(newTask);
      expect(harness.store.tasks()).toMatchObject([
        { id: 'task-a', status: 'setting_up' },
      ]);
    });

    it('stamps each appended event with a sequence number and the clock time', () => {
      harness.store.createTask(newTask);
      harness.clock.set(1_000);
      const first = harness.store.append('task-a', {
        type: 'setup_finished',
        ok: true,
        log: '',
      });
      harness.clock.set(2_500);
      const second = harness.store.append('task-a', { type: 'setup_started' });

      expect(second.seq).toBeGreaterThan(first.seq);
      expect(first).toMatchObject({ taskId: 'task-a', at: 1_000 });
      expect(second).toMatchObject({ taskId: 'task-a', at: 2_500 });
    });

    it("returns a task's events in the order they were appended, payloads intact", () => {
      harness.store.createTask(newTask);
      harness.store.append('task-a', started);
      harness.store.append('task-a', {
        type: 'gate_finished',
        attemptId: 'plan-1',
        passed: false,
        failures: [
          {
            command: 'pnpm test',
            exitCode: 1,
            timedOut: false,
            tail: 'boom',
            logPath: '/log',
          },
        ],
      });

      const events = harness.store.events('task-a');
      expect(events.map((stored) => stored.event)).toEqual([
        started,
        {
          type: 'gate_finished',
          attemptId: 'plan-1',
          passed: false,
          failures: [
            {
              command: 'pnpm test',
              exitCode: 1,
              timedOut: false,
              tail: 'boom',
              logPath: '/log',
            },
          ],
        },
      ]);
    });

    it('keeps the events of different tasks apart', () => {
      harness.store.createTask(newTask);
      harness.store.createTask({ ...newTask, taskId: 'task-b' });
      harness.store.append('task-a', { type: 'setup_started' });
      harness.store.append('task-b', { type: 'setup_started' });
      harness.store.append('task-b', {
        type: 'setup_finished',
        ok: true,
        log: '',
      });

      expect(harness.store.events('task-a')).toHaveLength(1);
      expect(harness.store.events('task-b')).toHaveLength(2);
    });

    it('returns only the events after a sequence number', () => {
      harness.store.createTask(newTask);
      const first = harness.store.append('task-a', { type: 'setup_started' });
      harness.store.append('task-a', {
        type: 'setup_finished',
        ok: true,
        log: '',
      });

      const after = harness.store.eventsSince(first.seq);
      expect(after.map((stored) => stored.event.type)).toEqual([
        'setup_finished',
      ]);
    });

    it('filters listed tasks by status', () => {
      harness.store.createTask(newTask);
      harness.store.createTask({ ...newTask, taskId: 'task-b' });
      harness.store.setTaskStatus('task-b', 'blocked');

      expect(
        harness.store.tasks({ status: ['blocked'] }).map((row) => row.id),
      ).toEqual(['task-b']);
      harness.store.setTaskStatus('task-b', 'parked');
      expect(
        harness.store.tasks({ status: ['parked'] }).map((row) => row.id),
      ).toEqual(['task-b']);
      harness.store.setTaskStatus('task-b', 'queued');
      expect(
        harness.store.tasks({ status: ['queued'] }).map((row) => row.id),
      ).toEqual(['task-b']);
      harness.store.setTaskStatus('task-b', 'blocked');
      expect(
        harness.store
          .tasks()
          .map((row) => row.id)
          .sort(),
      ).toEqual(['task-a', 'task-b']);
    });

    it('reports a running attempt from its start until a terminal event', () => {
      harness.store.createTask(newTask);
      harness.store.append('task-a', started);
      expect(harness.store.runningAttempt('task-a', 'plan-1')).toEqual({
        attemptId: 'plan-1',
        stepId: 'plan',
        n: 1,
      });

      harness.store.append('task-a', {
        type: 'agent_ready',
        attemptId: 'plan-1',
        pane: 'p',
        tab: 't',
      });
      expect(harness.store.runningAttempt('task-a', 'plan-1')).toBeDefined();

      harness.store.append('task-a', {
        type: 'completed',
        attemptId: 'plan-1',
      });
      expect(harness.store.runningAttempt('task-a', 'plan-1')).toBeUndefined();
    });

    it('reports no running attempt for an unknown attempt', () => {
      harness.store.createTask(newTask);
      expect(harness.store.runningAttempt('task-a', 'nope-1')).toBeUndefined();
    });

    it('rejects an event that does not match its schema', () => {
      harness.store.createTask(newTask);
      const invalid: FactoryEvent = {
        type: 'setup_finished',
        // @ts-expect-error deliberately invalid: `ok` must be a boolean
        ok: 'yes',
        log: '',
      };
      expect(() => harness.store.append('task-a', invalid)).toThrow();
      expect(harness.store.events('task-a')).toEqual([]);
    });

    it('rejects events for a task that was never created', () => {
      expect(() =>
        harness.store.append('ghost', { type: 'setup_started' }),
      ).toThrow();
    });
  });
};
