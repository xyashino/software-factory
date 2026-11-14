import type { Database } from 'bun:sqlite';
import type { Signal } from '@repo/factory-core/contracts/worker';
import type { SignalStore } from '@repo/factory-core/ports/signals';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

interface SignalRow {
  signal_id: string;
  job_id: string;
  kind: string;
  payload: string;
}

const signalOf = (row: SignalRow): Signal =>
  ({
    signalId: row.signal_id,
    jobId: row.job_id,
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
): SignalStore => ({
  insert: (signal) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        'INSERT INTO signals (signal_id, job_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
        [
          signal.signalId,
          signal.jobId,
          signal.kind,
          JSON.stringify(payloadOf(signal)),
          signal.createdAt,
        ],
      );
    }),
  unacked: (jobId) =>
    gate.run(() =>
      db
        .query<SignalRow, [string]>(
          'SELECT signal_id, job_id, kind, payload FROM signals WHERE job_id = ? AND acked_at IS NULL ORDER BY created_at, signal_id',
        )
        .all(jobId)
        .map(signalOf),
    ),
  ack: (signalIds, at) =>
    gate.run(() => {
      writer.assertHeld();
      const statement = db.query(
        'UPDATE signals SET acked_at = ? WHERE signal_id = ? AND acked_at IS NULL',
      );
      for (const signalId of signalIds) {
        statement.run(at, signalId);
      }
    }),
  deleteForJob: (jobId) =>
    gate.run(() => {
      writer.assertHeld();
      db.run('DELETE FROM signals WHERE job_id = ?', [jobId]);
    }),
});
