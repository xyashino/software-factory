import type { CommandHandler } from './command-handler';
import { isRuntimeError } from './errors';
import type { RuntimePorts } from './ports';

/** Refusals that mean the lease no longer names a live job, so the lease row is simply dropped. */
const STALE_LEASE_CODES = new Set(['stale_epoch', 'not_found', 'precondition']);

/**
 * One reaper pass (PROTOCOL §5.4): every lease whose expiry has passed runs `ExpireLease` through the
 * normal loop, so `cycle_failed{lost}` and `job_lost` are appended and the restart budget is checked
 * (`andon_raised` when it is spent). A lease whose job already ended is only deleted.
 */
export const reapOnce = async (
  ports: RuntimePorts,
  handler: CommandHandler,
): Promise<number> => {
  ports.writer.assertHeld();
  const expired = await ports.leases.expired(ports.clock.now());
  for (const lease of expired) {
    try {
      await handler.submit({
        orderId: lease.orderId,
        commandId: `reap:${lease.jobId}`,
        command: { type: 'ExpireLease' },
        actor: { kind: 'factory' },
        epoch: lease.epoch,
      });
    } catch (error) {
      if (!isRuntimeError(error) || !STALE_LEASE_CODES.has(error.wire.code)) {
        throw error;
      }
      await ports.leases.delete(lease.orderId);
    }
  }
  return expired.length;
};

/**
 * Boot grace (PROTOCOL §5.1): on start, every lease gets a full TTL from now, so a Factory that was
 * down does not cost the Workers their jobs before they can heartbeat again.
 */
export const bootGrace = async (ports: RuntimePorts): Promise<void> => {
  ports.writer.assertHeld();
  const expiresAt = ports.clock.now() + ports.config.leaseTtlMs;
  for (const lease of await ports.leases.list()) {
    await ports.leases.extend(lease.workerId, [lease.jobId], expiresAt);
  }
};
