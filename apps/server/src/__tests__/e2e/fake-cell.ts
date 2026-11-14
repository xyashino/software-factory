import { createHash } from 'node:crypto';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type {
  BlobRef,
  CellId,
  CommitSha,
  ProjectId,
} from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';

/** The commit every Station reports. The runtime checks its shape, not its ancestry. */
export const FAKE_COMMIT = 'b'.repeat(40) as CommitSha;

/** The pull request a delivery reports. */
export const FAKE_PR_URL = 'https://example.test/software-factory/pull/1';

export interface FakeCell {
  /** Announces the Cell to the runtime (PROTOCOL §3.2). A Cell says hello before it claims. */
  hello(): Promise<void>;
  /** Claims one job, long-polling up to `waitMs`. */
  claim(waitMs: number): Promise<Job | null>;
  /**
   * Runs one job to its end, the way a Cell does: start the Cycle, upload the declared outputs,
   * then complete it, submit its verdict, or report its inspections. Returns the continuation.
   */
  run(job: Job): Promise<Job | null>;
  /** Claims and runs jobs until none is on offer; returns the jobs it ran, in order. */
  drain(waitMs?: number): Promise<Job[]>;
}

/**
 * A scripted Cell that talks to the runtime only through the socket client (PROTOCOL §3.2): the
 * same routes a real Cell calls, with a command id per job and step, so a replay is recognised.
 */
export const createFakeCell = (
  client: FactoryClient,
  cellId: CellId,
  projectId: ProjectId,
): FakeCell => {
  const put = async (
    text: string,
    mediaType = 'text/markdown',
  ): Promise<BlobRef> => {
    const bytes = new TextEncoder().encode(text);
    const ref =
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
    await client.call('blobPut', {
      ref,
      base64: Buffer.from(bytes).toString('base64'),
      mediaType,
    });
    return ref;
  };

  const submit = (job: Job, step: string, command: OrderCommand) =>
    client.call('submitCommand', {
      cellId,
      orderId: job.orderId,
      jobId: job.jobId,
      commandId: `${job.jobId}:${step}`,
      epoch: job.epoch,
      command,
    });

  const runStation = async (job: Job): Promise<Job | null> => {
    const station = job.station;
    if (!station?.cycleId) throw new Error(`job ${job.jobId} names no Cycle`);
    const cycleId = station.cycleId;
    await submit(job, 'start', { type: 'StartCycle', baseCommit: FAKE_COMMIT });

    if (job.kind === 'run_inspection') {
      const results = [];
      for (const command of station.exec ?? []) {
        results.push({
          command,
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
          tail: 'ok',
          logBlob: await put(`$ ${command}\nok\n`, 'text/plain'),
        });
      }
      const result = await submit(job, 'inspect', {
        type: 'ReportInspection',
        cycleId,
        passed: true,
        results,
      });
      return result.next;
    }

    const artifacts: Record<string, BlobRef> = {};
    for (const output of station.outputs ?? []) {
      artifacts[output.key] = await put(
        `# ${output.key}\n\nFrom ${station.stationId}.\n`,
      );
    }
    if (station.verdict) {
      const result = await submit(job, 'verdict', {
        type: 'SubmitVerdict',
        cycleId,
        pass: true,
        artifacts,
      });
      return result.next;
    }
    const result = await submit(job, 'complete', {
      type: 'CompleteCycle',
      cycleId,
      artifacts,
      commit: FAKE_COMMIT,
    });
    return result.next;
  };

  const run = async (job: Job): Promise<Job | null> => {
    if (job.kind === 'deliver') {
      const result = await submit(job, 'deliver', {
        type: 'ReportDelivery',
        result: { status: 'finished', prUrl: FAKE_PR_URL, commit: FAKE_COMMIT },
      });
      return result.next;
    }
    return runStation(job);
  };

  const claim = async (waitMs: number): Promise<Job | null> =>
    (await client.call('claim', { cellId, waitMs })).job;

  const hello = async (): Promise<void> => {
    await client.call('hello', {
      cellId,
      version: '0.1.0',
      projects: [projectId],
      runners: ['claude', 'cursor'],
      capabilities: [],
      slots: 1,
    });
  };

  return {
    hello,
    claim,
    run,
    drain: async (waitMs = 0) => {
      await hello();
      const ran: Job[] = [];
      let job = await claim(waitMs);
      while (job) {
        ran.push(job);
        job = (await run(job)) ?? (await claim(waitMs));
      }
      return ran;
    },
  };
};
