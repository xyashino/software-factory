import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { CellId } from '@repo/factory-core/ids';
import type { ClockPort } from '../ports/clock.port';
import type { JobRegistry } from '../jobs/registry';
import { isUnauthorized } from '../remote-client';

export interface HeartbeatOptions {
  client: FactoryClient;
  cellId: CellId;
  registry: JobRegistry;
  clock: ClockPort;
  /** No ok heartbeat for this long fences the Cell: every job is aborted and claims pause (PROTOCOL §5.4). */
  selfFenceMs: number;
  /** Called once when the Cell fences itself, with the time of its last ok heartbeat. */
  onFence?: (lastOkAt: number) => void;
  /** The Factory refused the credential (401) on a beat: the Cell stops its jobs and joins again. */
  onUnauthorized?: () => void;
}

export interface Heartbeat {
  /** One beat, then the fence check. Failures are not thrown: they only age the last ok beat. */
  tick(): Promise<void>;
  /** The fence check alone. Runs more often than a beat, so the fence lands on time. */
  checkFence(): void;
  /** True from the fence until the next ok beat. Claims wait while it is true. */
  readonly fenced: boolean;
}

/**
 * The one heartbeat loop of a Cell (PROTOCOL §5.3): every held job id goes out in one call, the
 * signals acknowledged by the last beat come back as acks, and the answer's `stale` jobs are aborted.
 * A signal the Factory sends is delivered to its job and acked on the next beat, so a beat that fails
 * sends the acks again.
 */
export const createHeartbeat = (options: HeartbeatOptions): Heartbeat => {
  let lastOkAt = options.clock.now();
  let fenced = false;
  let pendingAcks: string[] = [];

  const fenceIfSilent = (): void => {
    if (fenced) return;
    if (options.clock.now() - lastOkAt < options.selfFenceMs) return;
    fenced = true;
    options.registry.abortAll('self-fenced: no heartbeat');
    options.onFence?.(lastOkAt);
  };

  let beating: Promise<void> | undefined;

  const beat = async (): Promise<void> => {
    const acked = [...pendingAcks];
    try {
      const answer = await options.client.call('heartbeat', {
        cellId: options.cellId,
        jobs: options.registry.activeJobIds(),
        acked,
      });
      lastOkAt = options.clock.now();
      fenced = false;
      pendingAcks = pendingAcks.filter((id) => !acked.includes(id));
      for (const job of answer.jobs) {
        if (job.status === 'stale') {
          options.registry.abort(job.jobId, 'stale: the lease moved on');
        }
      }
      for (const signal of answer.signals) {
        // Delivered by an earlier beat, acked by this one: never hand it to a job twice.
        if (acked.includes(signal.signalId)) continue;
        if (options.registry.deliver(signal)) {
          pendingAcks.push(signal.signalId);
        }
      }
    } catch (error) {
      if (isUnauthorized(error)) options.onUnauthorized?.();
      // A failed beat is retried on the next tick; the fence below decides when it matters.
    }
    fenceIfSilent();
  };

  return {
    get fenced() {
      return fenced;
    },
    checkFence() {
      fenceIfSilent();
    },
    tick() {
      // A slow beat is not joined by a second one: the interval may fire while the first is in flight.
      beating ??= beat().finally(() => {
        beating = undefined;
      });
      return beating;
    },
  };
};
