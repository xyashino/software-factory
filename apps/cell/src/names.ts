import { createHash } from 'node:crypto';

/** The branch of a Work order: one per order, created from the base branch (PROTOCOL §8.1). */
export const branchFor = (todoId: string): string => `factory/${todoId}`;

/** The WIP ref of a failed Cycle, for the Supervisor only (PROTOCOL §8.1). */
export const wipRefFor = (todoId: string, cycleId: string): string =>
  `factory-wip/${todoId}/${cycleId}`;

/**
 * The Herdr agent name of a Cycle: unique per station and Cycle, within Herdr's 32-character rule
 * `^[a-z][a-z0-9_-]{0,31}$` (v1 `agentName`, ported).
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
  const suffix = `_${n}`;
  const head = /^[a-z]/.test(cleanStation) ? cleanStation : `s${cleanStation}`;
  const maxHead = 32 - suffix.length;
  if (head.length <= maxHead) return `${head}${suffix}`;
  const hash = createHash('sha256').update(cycleId).digest('hex').slice(0, 6);
  const prefix = head.slice(0, maxHead - 7).replace(/-+$/, '');
  return `${prefix}_${hash}${suffix}`;
};

/**
 * The directory of one Cycle's scratch files. The socket path is kept short: a unix socket path is
 * limited to about 108 bytes, so the Cycle is named by a short digest, not its full ULID.
 */
export const cycleDirName = (cycleId: string): string =>
  createHash('sha256').update(cycleId).digest('hex').slice(0, 12);
