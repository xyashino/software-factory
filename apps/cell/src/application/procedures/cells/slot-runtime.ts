import { eq } from 'drizzle-orm';
import { cells } from '../../../db/schema/cells';
import { canStop, type RuntimeStatus } from '../../../domain/cells/cell-slot';
import type { SlotId } from '../../../domain/common/brand';
import type { CellEvent } from '@repo/cell-contracts/stream.contract';
import type { TransportContext } from '../../core/procedure';
import { readSettings, launchOf, type CellRecord } from './cell-views';

export type SlotRuntimeDeps = Pick<
  TransportContext,
  'db' | 'clock' | 'eventBus' | 'supervisor'
>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const updateSlot = (
  deps: SlotRuntimeDeps,
  slotId: SlotId,
  patch: Partial<typeof cells.$inferInsert>,
): void => {
  deps.db
    .update(cells)
    .set({ ...patch, updatedAt: deps.clock.now() })
    .where(eq(cells.slotId, slotId))
    .run();
};

const publish = (
  deps: SlotRuntimeDeps,
  kind: CellEvent['kind'],
  slotId: SlotId,
): void => {
  deps.eventBus.publish({ kind, at: deps.clock.now(), slotId });
};

const markRuntime = (
  deps: SlotRuntimeDeps,
  slotId: SlotId,
  runtimeStatus: RuntimeStatus,
  patch: Partial<typeof cells.$inferInsert> = {},
): void => updateSlot(deps, slotId, { runtimeStatus, ...patch });

const markFailed = (
  deps: SlotRuntimeDeps,
  slotId: SlotId,
  error: unknown,
): void => {
  markRuntime(deps, slotId, 'failed', {
    pid: null,
    lastError: messageOf(error),
  });
  publish(deps, 'cell.failed', slotId);
};

export const startSlot = async (
  deps: SlotRuntimeDeps,
  record: CellRecord,
): Promise<void> => {
  const slotId = record.slot.slotId;
  updateSlot(deps, slotId, {
    desiredState: 'running',
    runtimeStatus: 'starting',
    lastError: null,
  });
  try {
    const launch = launchOf(record, readSettings(deps.db).herdr_enabled);
    const { pid } = await deps.supervisor.start(launch);
    markRuntime(deps, slotId, 'running', { pid });
    publish(deps, 'cell.started', slotId);
  } catch (error) {
    markFailed(deps, slotId, error);
  }
};

export const stopSlot = async (
  deps: SlotRuntimeDeps,
  record: CellRecord,
  force: boolean,
): Promise<void> => {
  const slotId = record.slot.slotId;
  updateSlot(deps, slotId, { desiredState: 'stopped' });
  if (!canStop(record.slot.runtimeStatus)) return;
  markRuntime(deps, slotId, 'stopping');
  publish(deps, 'cell.stopping', slotId);
  try {
    await deps.supervisor.stop(slotId, { force });
    markRuntime(deps, slotId, 'stopped', { pid: null });
    publish(deps, 'cell.stopped', slotId);
  } catch (error) {
    markFailed(deps, slotId, error);
  }
};
