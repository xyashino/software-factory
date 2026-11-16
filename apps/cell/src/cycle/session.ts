import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { jobSchema } from '@repo/factory-core/contracts/job';
import { z } from 'zod';
import { cycleDirName } from '../names';

/**
 * What a Cell keeps of a live Herdr Operator pane, so the next Cell on this machine can re-adopt it
 * (`cycle/reconcile.ts`). The file holds the operator token: it is written 0600 and never logged.
 */
export const sessionSchema = z.object({
  orderId: z.string().min(1),
  jobId: z.string().min(1),
  cycleId: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  stationId: z.string().min(1),
  paneName: z.string().min(1),
  tabId: z.string().min(1),
  taskName: z.string().min(1),
  operatorToken: z.string().min(1),
  operatorPort: z.number().int().min(1).max(65535),
  worktree: z.string().min(1),
  startedAt: z.number(),
  cycle: z.object({
    startedAt: z.number(),
    pausedMs: z.number().nonnegative(),
    pausedSince: z.number().optional(),
    reminders: z.object({
      idle: z.number().int().nonnegative(),
      silent: z.number().int().nonnegative(),
    }),
    lastIdleReminderAt: z.number().optional(),
  }),
  /** The fingerprint a read-only station is judged against; absent for a station that may write. */
  readOnlyBaseline: z.string().optional(),
  /** The Job the station runs, as the claim handed it to this Cell. */
  job: jobSchema,
});

export type Session = z.infer<typeof sessionSchema>;

/** The session file of one Cycle: `<cellDataDir>/cycles/<cycleDir>/session.json`. */
export const sessionPathOf = (cellDataDir: string, cycleId: string): string =>
  join(cellDataDir, 'cycles', cycleDirName(cycleId), 'session.json');

/** Writes the session atomically, owner-only: a temporary file, then a rename over the old one. */
export const writeSession = (cellDataDir: string, session: Session): void => {
  const path = sessionPathOf(cellDataDir, session.cycleId);
  mkdirSync(join(cellDataDir, 'cycles', cycleDirName(session.cycleId)), {
    recursive: true,
  });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
};

/** Reads one session file. A missing, unreadable or invalid file is no session. */
export const readSession = (path: string): Session | undefined => {
  try {
    const parsed = sessionSchema.safeParse(
      JSON.parse(readFileSync(path, 'utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Every valid session this Cell's data directory holds. Invalid files are skipped, never thrown. */
export const listSessions = (cellDataDir: string): Session[] => {
  let dirs: string[];
  try {
    dirs = readdirSync(join(cellDataDir, 'cycles'));
  } catch {
    return [];
  }
  return dirs.flatMap((dir) => {
    const session = readSession(
      join(cellDataDir, 'cycles', dir, 'session.json'),
    );
    return session === undefined ? [] : [session];
  });
};

/** Removes the session of one Cycle. Removing a session that is not there is not an error. */
export const deleteSession = (cellDataDir: string, cycleId: string): void => {
  rmSync(sessionPathOf(cellDataDir, cycleId), { force: true });
};
