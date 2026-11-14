import type { Definitions } from '@repo/factory-definitions/load';
import type { ArchivePort } from '@repo/factory-core/ports/archive';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import type { CellStore } from '@repo/factory-core/ports/cells';
import type { Clock } from '@repo/factory-core/ports/clock';
import type { EventFeed } from '@repo/factory-core/ports/event-feed';
import type { EventStore } from '@repo/factory-core/ports/event-store';
import type { GitMirror } from '@repo/factory-core/ports/git-mirror';
import type { IntakeStore } from '@repo/factory-core/ports/intake';
import type { JoinTokenStore } from '@repo/factory-core/ports/join-tokens';
import type { LeaseStore } from '@repo/factory-core/ports/lease-store';
import type { PrStatePort } from '@repo/factory-core/ports/pr-state';
import type { ProjectionReader } from '@repo/factory-core/ports/projection-reader';
import type { ProjectStore } from '@repo/factory-core/ports/projects';
import type { SignalStore } from '@repo/factory-core/ports/signals';
import type { SupervisorTokenStore } from '@repo/factory-core/ports/supervisor-tokens';
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
  /** Intake poll interval (ROADMAP M4). 0 turns the timer off; `sync` still works. */
  intakePollMs: number;
  /** PR state poll interval for delivered Work orders. 0 turns the timer off. */
  prPollMs: number;
  /** Cut-over flag (ROADMAP M9): only todos with `factory: v2` become Work orders. */
  v2Only: boolean;
  /** How long the event feed waits for a commit before it reads again. */
  feedPollMs: number;
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
  intakePollMs: 60_000,
  prPollMs: 300_000,
  v2Only: true,
  feedPollMs: 1_000,
};

/** Everything the runtime receives from outside. It opens nothing itself. */
export interface RuntimePorts {
  events: EventStore;
  projections: ProjectionReader;
  projects: ProjectStore;
  blobs: BlobStore;
  leases: LeaseStore;
  cells: CellStore;
  joinTokens: JoinTokenStore;
  /** Supervisor tokens by hash (PROTOCOL §1): the remote Supervisor credential. */
  supervisorTokens: SupervisorTokenStore;
  signals: SignalStore;
  clock: Clock;
  ids: RuntimeIds;
  timers: Timers;
  writer: WriterGuard;
  definitions: Definitions;
  config: RuntimeConfig;
  /** The export archive of the whole Factory (STORAGE §7.3); the database adapter builds it. */
  exportArchive(): Promise<Uint8Array>;
  /** Intake rows: what each todo file looked like at its last sync (STORAGE §4). */
  intake: IntakeStore;
  /** The projects' bare mirrors (PROTOCOL §3.0). Behind a port: the runtime runs no git itself. */
  git: GitMirror;
  /** The pull request state reader for delivered Work orders (ROADMAP M4). */
  prState: PrStatePort;
  /** The event feed behind `GET /v1/stream` (PROTOCOL §3.1). */
  feed: EventFeed;
  /** Backup, export, import and projection rebuild (STORAGE §7). */
  archive: ArchivePort;
}
