import type { Definitions } from '@repo/factory-definitions/load';
import type { EventStore } from '@repo/factory-core/ports/event-store';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import type { LeaseStore } from '@repo/factory-core/ports/lease-store';
import type { ProjectStore } from '@repo/factory-core/ports/projects';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { SignalStore } from '@repo/factory-core/ports/signals';
import type { CellStore } from '@repo/factory-core/ports/cells';
import type { JoinTokenStore } from '@repo/factory-core/ports/join-tokens';
import type { Clock } from '@repo/factory-core/ports/clock';
import type { RuntimeIds } from './ids';

/**
 * The write lock as the runtime sees it. Every write use case asks it first; a released or never
 * acquired lock throws, so a second process or a stale handle cannot append (STORAGE §1).
 */
export interface WriterGuard {
  readonly held: boolean;
  assertHeld(): void;
}

/** One-shot timers, injected so tests can drive long-polls and the reaper by hand. */
export interface Timers {
  /** Runs `fn` after `ms`. Returns the cancel function. */
  after(ms: number, fn: () => void): () => void;
}

/** Factory settings returned to Cells at `hello` (PROTOCOL §5.1), plus the runtime's own knobs. */
export interface RuntimeConfig {
  leaseTtlMs: number;
  heartbeatMs: number;
  reaperMs: number;
  selfFenceMs: number;
  /** How often a waiting claim re-reads the queue when nothing woke it. */
  claimTickMs: number;
  /** Tries of one command before `unavailable` (STORAGE §3). */
  commandAttempts: number;
  /** Whether a job-ending Cell command also claims the next job of its Work order (PROTOCOL §4). */
  continuation: boolean;
  /** Timeout of an inspection command when its Line does not set one. */
  inspectionTimeoutMs: number;
  /** Characters kept from the end of each inspection log in a prompt (PROTOCOL §4). */
  logTailChars: number;
  /** The Operator's own CLI, listed in every prompt (PROTOCOL §3.3). */
  operatorCommands: string[];
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  leaseTtlMs: 60_000,
  heartbeatMs: 15_000,
  reaperMs: 5_000,
  selfFenceMs: 45_000,
  claimTickMs: 1_000,
  commandAttempts: 3,
  continuation: true,
  inspectionTimeoutMs: 600_000,
  logTailChars: 12_000,
  operatorCommands: [
    'factory-operator done',
    'factory-operator verdict pass | fail --feedback <file>',
    'factory-operator ask "<question>"',
    'factory-operator tell <station|supervisor> "<note>"',
    'factory-operator block --reason "<why>" --handover <file>',
    'factory-operator context',
  ],
};

/**
 * Intake (PROTOCOL §3.1, CORE §5): reads the todos at the base branch and writes the Work orders.
 * It is wired by the intake slice (v2-10). Until a runner is wired, `intakeSync` refuses.
 */
export interface IntakeRunner {
  /** Runs one intake pass now; `created` counts the Work orders it opened. */
  sync(): Promise<{ created: number }>;
}

/** Everything the runtime receives from outside. It opens nothing itself. */
export interface RuntimePorts {
  events: EventStore;
  projections: ProjectionReader;
  projects: ProjectStore;
  blobs: BlobStore;
  leases: LeaseStore;
  cells: CellStore;
  joinTokens: JoinTokenStore;
  signals: SignalStore;
  clock: Clock;
  ids: RuntimeIds;
  timers: Timers;
  writer: WriterGuard;
  definitions: Definitions;
  config: RuntimeConfig;
  /** The export archive of the whole Factory (STORAGE §7.3); the database adapter builds it. */
  exportArchive(): Promise<Uint8Array>;
  /** The intake runner, once v2-10 wires it. Absent means intake is not built in this server. */
  intake?: IntakeRunner;
}
