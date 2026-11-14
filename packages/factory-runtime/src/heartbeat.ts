import type {
  HeartbeatRequest,
  HeartbeatResponse,
  Signal,
} from '@repo/factory-core/contracts/worker';
import type { JobId } from '@repo/factory-core/ids';
import type { RuntimePorts } from './ports';
import { assertWorker } from './workers';

/**
 * A Worker's heartbeat (PROTOCOL §5, §7): every job it names that it still holds gets its lease
 * extended and reports `ok`; any other job reports `stale`, the cue to stop it. Acknowledged signals
 * are dropped; the unacknowledged signals of the live jobs come back in the response.
 */
export const heartbeat = async (
  ports: RuntimePorts,
  request: HeartbeatRequest,
): Promise<HeartbeatResponse> => {
  ports.writer.assertHeld();
  const { workerId } = request;
  await assertWorker(ports, workerId);
  const now = ports.clock.now();
  await ports.workers.touch(workerId, now);
  await ports.signals.ack(request.acked, now);

  const held = new Set<JobId>(
    (await ports.leases.forWorker(workerId)).map((lease) => lease.jobId),
  );
  const jobs = request.jobs.map((jobId) => ({
    jobId,
    status: held.has(jobId) ? ('ok' as const) : ('stale' as const),
  }));
  const live = jobs
    .filter((job) => job.status === 'ok')
    .map((job) => job.jobId);
  if (live.length > 0) {
    await ports.leases.extend(workerId, live, now + ports.config.leaseTtlMs);
  }
  const signals: Signal[] = [];
  for (const jobId of live) {
    signals.push(...(await ports.signals.unacked(jobId)));
  }
  return { jobs, signals };
};
