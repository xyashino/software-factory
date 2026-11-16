import { createHash } from 'node:crypto';

/** The branch of a Work order: one per order, created from the base branch (PROTOCOL §8.1). */
export const branchFor = (todoId: string): string => `factory/${todoId}`;

/** The namespace of every snapshot ref of a Work order (v1: `refs/software-factory/<taskId>/`). */
export const snapshotNamespaceOf = (todoId: string): string =>
  `refs/software-factory/${todoId}/`;

/**
 * The ref of one Cycle's pre-cycle snapshot: `refs/software-factory/<todoId>/<stationId>/<cycleId>`. The
 * Cycle id is a ULID, so the refs of one station sort oldest first.
 */
export const snapshotRefFor = (
  todoId: string,
  stationId: string,
  cycleId: string,
): string => `${snapshotNamespaceOf(todoId)}${stationId}/${cycleId}`;

/** The namespace of one station's snapshot refs within a Work order. */
export const stationSnapshotNamespaceOf = (
  todoId: string,
  stationId: string,
): string => `${snapshotNamespaceOf(todoId)}${stationId}/`;

/**
 * The Herdr agent name of a Cycle: `<station>_<hash>_<n>`, where the hash is a digest of the Cycle (or
 * Mechanic job) id. The hash is always present, so two Cells running the same station with the same
 * attempt number never share a name. The whole name stays within Herdr's 32-character rule
 * `^[a-z][a-z0-9_-]{0,31}$`: the station head is cut to fit.
 */
export const paneName = (
  stationId: string,
  n: number,
  cycleId: string,
): string => {
  const cleanStation =
    stationId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/^-+|-+$/g, '') || 'station';
  const head = /^[a-z]/.test(cleanStation) ? cleanStation : `s${cleanStation}`;
  const hash = createHash('sha256').update(cycleId).digest('hex').slice(0, 6);
  const suffix = `_${hash}_${n}`;
  const maxHead = 32 - suffix.length;
  const cut = head.slice(0, maxHead).replace(/[-_]+$/, '');
  return `${cut}${suffix}`;
};

/**
 * The directory of one Cycle's scratch files. The Cycle is named by a short digest, not its full
 * ULID, so the directory name stays short and stable.
 */
export const cycleDirName = (cycleId: string): string =>
  createHash('sha256').update(cycleId).digest('hex').slice(0, 12);
