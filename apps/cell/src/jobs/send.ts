import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import { fitBlob } from '@repo/factory-core/blob-rules';
import type { CellId, BlobRef } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import type { OrderEvent } from '@repo/factory-core/order/events';
import type { SystemPort } from '../ports/system.port';
import { commandIdOf } from '../factory-client';

/** What a job needs from the Cell: the client, the identity, the system, and the local directories. */
export interface JobContext {
  client: FactoryClient;
  cellId: CellId;
  system: SystemPort;
  cellDataDir: string;
  worktreeLimit: number;
  /** Worktrees a job holds; eviction keeps them. */
  inUse: Set<string>;
}

/**
 * Thrown when the job must send nothing more: its signal fired (self-fence, stale lease, shutdown). No
 * command is sent after the fence (PROTOCOL §5.4), so the job ends here.
 */
export class JobStopped extends Error {
  constructor(reason: string) {
    super(`job stopped: ${reason}`);
    this.name = 'JobStopped';
  }
}

const encoder = new TextEncoder();
const TAIL_BYTES = 2048;

/** The `sha256:<hex>` ref of bytes, as the server hashes them. */
export const blobRefOf = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

/**
 * Uploads a log as a blob and returns its ref. The log is fitted first (head and tail kept past the
 * limit, as the store does), so the ref names the bytes that are stored.
 */
export const putLog = async (
  ctx: JobContext,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<BlobRef> => {
  if (signal.aborted) throw new JobStopped(String(signal.reason));
  const fitted = fitBlob(bytes, 'log');
  const ref = blobRefOf(fitted);
  await ctx.client.call('blobPut', {
    ref,
    base64: Buffer.from(fitted).toString('base64'),
    mediaType: 'text/plain',
  });
  return ref;
};

/** Sends one command for the job's order, with its content-derived commandId. */
export const submit = async (
  ctx: JobContext,
  job: Job,
  command: OrderCommand,
  signal: AbortSignal,
): Promise<{ events: OrderEvent[] }> => {
  if (signal.aborted) throw new JobStopped(String(signal.reason));
  const answer = await ctx.client.call('submitCommand', {
    cellId: ctx.cellId,
    orderId: job.orderId,
    commandId: commandIdOf({
      cellId: ctx.cellId,
      orderId: job.orderId,
      epoch: job.epoch,
      command,
    }),
    epoch: job.epoch,
    command,
  });
  return answer;
};

/**
 * The last 2048 bytes of a log as text, with the terminal control sequences removed first. The cut lands
 * on a character boundary, so the tail is never a broken character.
 */
export const tailOf = (text: string): string => {
  const plain = stripVTControlCharacters(text);
  let tail = '';
  let bytes = 0;
  for (const character of Array.from(plain).reverse()) {
    const size = encoder.encode(character).length;
    if (bytes + size > TAIL_BYTES) break;
    tail = character + tail;
    bytes += size;
  }
  return tail;
};
