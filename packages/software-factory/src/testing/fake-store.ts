import { factoryEventSchema, type FactoryEvent } from '../engine/events';
import type { TaskStatus } from '../engine/state';
import type { ClockPort } from '../ports/clock.port';
import {
  type AttemptLookup,
  type NewTask,
  type StorePort,
  type StoredEvent,
  type TaskRow,
} from '../ports/store.port';
import { findRunningAttempt } from '../ports/running-attempt';

/** In-memory store with the same rules as the SQLite adapter. */
export class FakeStore implements StorePort {
  private readonly clock: ClockPort;
  private readonly rows = new Map<string, TaskRow>();
  private readonly log: StoredEvent[] = [];
  private lastSeq = 0;

  constructor(clock: ClockPort) {
    this.clock = clock;
  }

  createTask(input: NewTask): void {
    if (this.rows.has(input.taskId)) {
      throw new Error(`task "${input.taskId}" already exists`);
    }
    const now = this.clock.now();
    this.rows.set(input.taskId, {
      id: input.taskId,
      workflow: input.workflow,
      todoPath: input.todoPath,
      branch: input.branch,
      status: 'setting_up',
      createdAt: now,
      updatedAt: now,
    });
  }

  append(taskId: string, event: FactoryEvent): StoredEvent {
    this.requireTask(taskId);
    const stored: StoredEvent = {
      seq: (this.lastSeq += 1),
      taskId,
      at: this.clock.now(),
      event: factoryEventSchema.parse(event),
    };
    this.log.push(stored);
    return stored;
  }

  events(taskId: string): StoredEvent[] {
    return this.log.filter((stored) => stored.taskId === taskId);
  }

  eventsSince(seq: number): StoredEvent[] {
    return this.log.filter((stored) => stored.seq > seq);
  }

  tasks(filter?: { status?: TaskStatus[] }): TaskRow[] {
    return [...this.rows.values()]
      .filter(
        (row) =>
          filter?.status === undefined || filter.status.includes(row.status),
      )
      .map((row) => ({ ...row }));
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const row = this.requireTask(taskId);
    row.status = status;
    row.updatedAt = this.clock.now();
  }

  runningAttempt(taskId: string, attemptId: string): AttemptLookup | undefined {
    return findRunningAttempt(this.events(taskId), attemptId);
  }

  private requireTask(taskId: string): TaskRow {
    const row = this.rows.get(taskId);
    if (row === undefined) {
      throw new Error(`unknown task "${taskId}"`);
    }
    return row;
  }
}
