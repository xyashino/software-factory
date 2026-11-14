import type { HelloResponse, Hello } from '@repo/factory-core/contracts/worker';
import type { WorkerId } from '@repo/factory-core/ids';
import type { WorkerRecord } from '@repo/factory-core/ports/workers';
import { notFound, unauthorized } from './errors';
import type { RuntimePorts } from './ports';

/**
 * The Worker must be known and not revoked. Local trust is the operating-system account, so the
 * Worker is identified by the id it sends; only revocation withdraws it (PROTOCOL §1).
 */
export const assertWorker = async (
  ports: Pick<RuntimePorts, 'workers'>,
  workerId: WorkerId,
): Promise<WorkerRecord & { info: NonNullable<WorkerRecord['info']> }> => {
  const record = await ports.workers.get(workerId);
  if (!record || record.revokedAt !== null || !record.info)
    throw unauthorized();
  return { ...record, info: record.info };
};

/** Registers a Worker and returns the Factory settings it must follow (PROTOCOL §5.1). */
export const hello = async (
  ports: RuntimePorts,
  request: Hello,
): Promise<HelloResponse> => {
  ports.writer.assertHeld();
  const known = await ports.workers.get(request.workerId);
  if (known && known.revokedAt !== null) throw unauthorized();
  await ports.workers.hello({
    workerId: request.workerId,
    name: request.workerId,
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
    workerId: request.workerId,
    config: {
      leaseTtlMs: config.leaseTtlMs,
      heartbeatMs: config.heartbeatMs,
      reaperMs: config.reaperMs,
      selfFenceMs: config.selfFenceMs,
    },
  };
};

/**
 * Revokes a Worker (PROTOCOL §1): its leases expire now, so the next reaper pass runs `ExpireLease`
 * on each job. A revoked Worker is refused from then on.
 */
export const revokeWorker = async (
  ports: RuntimePorts,
  workerId: WorkerId,
): Promise<void> => {
  ports.writer.assertHeld();
  if (!(await ports.workers.get(workerId))) throw notFound();
  const now = ports.clock.now();
  await ports.workers.revoke(workerId, now);
  const held = await ports.leases.forWorker(workerId);
  await ports.leases.extend(
    workerId,
    held.map((lease) => lease.jobId),
    now,
  );
};
