import type { BlobRef } from '@repo/factory-core/ids';
import type {
  Actor,
  OrderEvent,
  StoredEvent,
} from '@repo/factory-core/order/events';
import { evolve } from '@repo/factory-core/order/evolve';
import type { DecideContext } from '@repo/factory-core/order/commands';
import type { WorkOrderState } from '@repo/factory-core/order/state';

/** The envelope version the store writes (CORE §11). */
const SCHEMA_VERSION = 2;

/** Folds a Traveler into the Work order state it describes. An empty history has no state. */
export const foldHistory = (
  stored: readonly StoredEvent[],
): WorkOrderState | undefined =>
  stored.reduce<WorkOrderState | undefined>(
    (state, event) => evolve(state, event),
    undefined,
  );

/** The seq of the last stored event; 0 for an empty history (the next event is seq 1). */
export const lastSeqOf = (stored: readonly StoredEvent[]): number =>
  stored.at(-1)?.seq ?? 0;

/** Where the events of one command sit in the history and who caused them. */
export interface EnvelopeMeta {
  orderId: StoredEvent['orderId'];
  firstSeq: number;
  at: number;
  actor: Actor;
  commandId: string;
  epoch?: number;
}

/**
 * Wraps bare events in the stored envelope, so `evolve` can fold them before they are written. The
 * store stamps the same fields on append, so the folded state matches what a later load returns.
 */
export const envelopeOf = (
  events: readonly OrderEvent[],
  meta: EnvelopeMeta,
): StoredEvent[] =>
  events.map((event, index) => ({
    schemaVersion: SCHEMA_VERSION,
    seq: meta.firstSeq + index,
    globalSeq: 1,
    orderId: meta.orderId,
    at: meta.at,
    actor: meta.actor,
    commandId: meta.commandId,
    ...(meta.epoch !== undefined ? { epoch: meta.epoch } : {}),
    event,
  }));

const BLOB_REF = /^sha256:[0-9a-f]{64}$/;

/** Every blob ref a command names, found anywhere in its payload. */
export const blobRefsIn = (value: unknown): BlobRef[] => {
  if (typeof value === 'string') {
    return BLOB_REF.test(value) ? [value as BlobRef] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => blobRefsIn(item));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item) => blobRefsIn(item));
  }
  return [];
};

/**
 * The `DecideContext` of one command: the clock, the ids, the actor and the epoch it claims, and the
 * sizes of the blobs it names, read from the store before `decide` runs (CORE §5.1).
 */
export const decideContext = (
  input: {
    now: number;
    ids: { next(): string };
    actor: Actor;
    epoch?: number;
  },
  blobSizes: ReadonlyMap<BlobRef, number>,
): DecideContext => ({
  now: input.now,
  ids: input.ids,
  actor: input.actor,
  ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
  blobs: {
    exists: (ref) => blobSizes.has(ref),
    size: (ref) => blobSizes.get(ref) ?? 0,
  },
});
