import type { Database } from 'bun:sqlite';
import type { Signal } from '@repo/factory-core/contracts/cell';
import type { SignalStore } from '@repo/factory-core/ports/signals';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { drizzleOf } from './db';
import { signals } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

type SignalRow = typeof signals.$inferSelect;

const signalOf = (row: SignalRow): Signal =>
  ({
    signalId: row.signalId,
    jobId: row.jobId,
    kind: row.kind,
    ...(JSON.parse(row.payload) as object),
  }) as Signal;

/** The payload column: what a Signal says beyond its id, job and kind (which are columns of their own). */
const payloadOf = (signal: Signal): Record<string, unknown> =>
  signal.kind === 'answer'
    ? { questionId: signal.questionId, text: signal.text }
    : { text: signal.text };

/** The `signals` table behind `SignalStore`. Every statement runs on the gate. */
export const sqliteSignalStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): SignalStore => {
  const orm = drizzleOf(db);
  return {
    insert: (signal) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(signals)
          .values({
            signalId: signal.signalId,
            jobId: signal.jobId,
            kind: signal.kind,
            payload: JSON.stringify(payloadOf(signal)),
            createdAt: signal.createdAt,
          })
          .run();
      }),
    unacked: (jobId) =>
      gate.run(() =>
        orm
          .select()
          .from(signals)
          .where(and(eq(signals.jobId, jobId), isNull(signals.ackedAt)))
          .orderBy(asc(signals.createdAt), asc(signals.signalId))
          .all()
          .map(signalOf),
      ),
    ack: (signalIds, at) =>
      gate.run(() => {
        writer.assertHeld();
        for (const signalId of signalIds) {
          orm
            .update(signals)
            .set({ ackedAt: at })
            .where(and(eq(signals.signalId, signalId), isNull(signals.ackedAt)))
            .run();
        }
      }),
    deleteForJob: (jobId) =>
      gate.run(() => {
        writer.assertHeld();
        orm.delete(signals).where(eq(signals.jobId, jobId)).run();
      }),
  };
};
