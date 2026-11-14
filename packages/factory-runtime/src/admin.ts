import type { OrderId } from '@repo/factory-core/ids';
import { nextJob } from '@repo/factory-core/order/next-job';
import { toProjection } from '@repo/factory-core/order/projection';
import type {
  ArchiveCounts,
  ProjectionOf,
} from '@repo/factory-core/ports/archive';
import type { CommandHandler } from './command-handler';
import type { RuntimePorts } from './ports';
import { foldHistory } from './state';

/** The projection of a folded Work order, with its next job (STORAGE §6): the rebuild's row function. */
export const projectionOf: ProjectionOf = (state, meta) =>
  toProjection(state, { ...meta, next: nextJob(state) });

/** Local admin operations (PROTOCOL §3.1, STORAGE §7). Each one needs the writer lock. */
export interface RuntimeAdmin {
  backup(file: string): Promise<ArchiveCounts>;
  exportTo(file: string): Promise<ArchiveCounts>;
  /**
   * Reads an export into an empty database, rebuilds the projections, then appends `ExpireLease` for
   * each Work order that had an active job: its lease did not travel, so its job is over (STORAGE §7).
   */
  importFrom(
    file: string,
  ): Promise<{ counts: ArchiveCounts; expired: OrderId[] }>;
  rebuildProjections(): Promise<number>;
}

export const createAdmin = (
  ports: RuntimePorts,
  handler: CommandHandler,
): RuntimeAdmin => ({
  backup: (file) => ports.archive.backup(file),
  exportTo: (file) => ports.archive.exportTo(file, ports.clock.now()),
  importFrom: async (file) => {
    const counts = await ports.archive.importFrom(
      file,
      projectionOf,
      ports.clock.now(),
    );
    const active = (await ports.projections.orders()).filter(
      (row) => row.holder === 'cell',
    );
    for (const row of active) {
      // ExpireLease is fenced by the epoch of the job it ends: name the active job's epoch.
      const state = foldHistory(await ports.events.load(row.orderId));
      const epoch = state?.activeJob?.epoch;
      if (epoch === undefined) continue;
      await handler.submit({
        orderId: row.orderId,
        commandId: `import-expire:${row.orderId}`,
        command: { type: 'ExpireLease' },
        actor: { kind: 'factory' },
        epoch,
      });
    }
    return { counts, expired: active.map((row) => row.orderId) };
  },
  rebuildProjections: () => ports.archive.rebuildProjections(projectionOf),
});
