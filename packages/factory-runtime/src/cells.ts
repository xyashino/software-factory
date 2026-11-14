import type { HelloResponse, Hello } from '@repo/factory-core/contracts/cell';
import type { CellId } from '@repo/factory-core/ids';
import type { CellRecord } from '@repo/factory-core/ports/cells';
import { notFound, unauthorized } from './errors';
import type { RuntimePorts } from './ports';

/**
 * The Cell must be known and not revoked. Local trust is the operating-system account, so the
 * Cell is identified by the id it sends; only revocation withdraws it (PROTOCOL §1).
 */
export const assertCell = async (
  ports: Pick<RuntimePorts, 'cells'>,
  cellId: CellId,
): Promise<CellRecord & { info: NonNullable<CellRecord['info']> }> => {
  const record = await ports.cells.get(cellId);
  if (!record || record.revokedAt !== null || !record.info)
    throw unauthorized();
  return { ...record, info: record.info };
};

/** Registers a Cell and returns the Factory settings it must follow (PROTOCOL §5.1). */
export const hello = async (
  ports: RuntimePorts,
  request: Hello,
): Promise<HelloResponse> => {
  ports.writer.assertHeld();
  const known = await ports.cells.get(request.cellId);
  if (known && known.revokedAt !== null) throw unauthorized();
  await ports.cells.hello({
    cellId: request.cellId,
    name: request.cellId,
    info: {
      version: request.version,
      projects: request.projects,
      runners: request.runners,
      capabilities: request.capabilities,
      slots: request.slots,
    },
    at: ports.clock.now(),
  });
  const config = ports.config;
  return {
    cellId: request.cellId,
    config: {
      leaseTtlMs: config.leaseTtlMs,
      heartbeatMs: config.heartbeatMs,
      reaperMs: config.reaperMs,
      selfFenceMs: config.selfFenceMs,
    },
  };
};

/**
 * Revokes a Cell (PROTOCOL §1): its leases expire now, so the next reaper pass runs `ExpireLease`
 * on each job. A revoked Cell is refused from then on.
 */
export const revokeCell = async (
  ports: RuntimePorts,
  cellId: CellId,
): Promise<void> => {
  ports.writer.assertHeld();
  if (!(await ports.cells.get(cellId))) throw notFound();
  const now = ports.clock.now();
  await ports.cells.revoke(cellId, now);
  const held = await ports.leases.forCell(cellId);
  await ports.leases.extend(
    cellId,
    held.map((lease) => lease.jobId),
    now,
  );
};
