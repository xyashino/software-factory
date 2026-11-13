import type { FactoryEvent, TimedEvent } from '../engine/events';
import type { TaskStatus } from '../engine/state';

export interface NewTask {
  taskId: string;
  workflow: string;
  todoPath: string;
  branch: string;
}

/** An event as stored: its sequence number, owning task and recording time. */
export interface StoredEvent extends TimedEvent {
  seq: number;
  taskId: string;
}

export interface TaskRow {
  id: string;
  workflow: string;
  todoPath: string;
  branch: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AttemptLookup {
  attemptId: string;
  stepId: string;
  n: number;
}

/** Append-only event log. Events are never updated or deleted. */
export interface StorePort {
  createTask(input: NewTask): void;
  /** Assigns `seq` and `at` (from the injected clock). */
  append(taskId: string, event: FactoryEvent): StoredEvent;
  events(taskId: string): StoredEvent[];
  eventsSince(seq: number): StoredEvent[];
  tasks(filter?: { status?: TaskStatus[] }): TaskRow[];
  setTaskStatus(taskId: string, status: TaskStatus): void;
  /** The attempt, if its latest event is a start or ready and no terminal event exists. */
  runningAttempt(taskId: string, attemptId: string): AttemptLookup | undefined;
}
