import { Hono, type Context } from 'hono';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';
import { streamQuery } from '@repo/hq-contracts/stream.contract';
import { asCommandId, asProjectId } from '../../../domain/common/brand';
import type { StateTransitionRecord } from '../../../domain/common/events';
import { BadRequest } from '../../../application/core/error-handling';
import { authorize } from '../../../application/core/procedure';
import type { StateTransitionRow } from '../../../application/ports/storage.port';
import type { AppEnv } from '../types';

const KEEPALIVE_MS = 15_000;

const toRecord = (row: StateTransitionRow): StateTransitionRecord => ({
  seq: row.seq,
  projectId: row.projectId,
  entityType: row.entityType,
  entityId: row.entityId,
  fromState: row.fromState,
  toState: row.toState,
  actorKind: row.actorKind,
  actorId: row.actorId,
  commandId: row.commandId === null ? null : asCommandId(row.commandId),
  meta: row.metaJson,
  at: row.at,
});

const writeTransition = (
  stream: SSEStreamingApi,
  record: StateTransitionRecord,
): Promise<void> =>
  stream.writeSSE({
    event: 'transition',
    id: String(record.seq),
    data: JSON.stringify(record),
  });

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

const streamTransitions = async (c: Context<AppEnv>): Promise<Response> => {
  const ctx = await authorize(c.get('transport'), ['supervisor:read']);
  const parsed = streamQuery.safeParse(c.req.query());
  if (!parsed.success)
    throw new BadRequest(
      `Invalid request payload: query: ${parsed.error.issues[0]?.message ?? 'invalid value'}`,
    );
  const { projectId, afterSeq } = parsed.data;
  const matches = (record: StateTransitionRecord): boolean =>
    projectId === undefined || record.projectId === projectId;

  return streamSSE(c, async (stream) => {
    let lastSeq = afterSeq;
    let writes: Promise<void> = Promise.resolve();
    const enqueue = (record: StateTransitionRecord): void => {
      // A write fails only after the client disconnects; the abort path tears the stream down.
      writes = writes
        .then(() => writeTransition(stream, record))
        .catch(() => undefined);
    };

    // Subscribe before reading the backlog: the bus is synchronous, so nothing
    // can commit between the read and the subscription.
    const unsubscribe = ctx.transitionBus.subscribe((record) => {
      if (record.seq <= lastSeq || !matches(record)) return;
      lastSeq = record.seq;
      enqueue(record);
    });
    const keepalive = setInterval(() => {
      writes = writes
        .then(async () => {
          await stream.write(': keepalive\n\n');
        })
        .catch(() => undefined);
    }, KEEPALIVE_MS);

    try {
      const backlog = await ctx.storage.read((tx) =>
        tx.transitions.listAfter(
          afterSeq,
          projectId === undefined ? undefined : asProjectId(projectId),
        ),
      );
      for (const row of backlog) {
        const record = toRecord(row);
        lastSeq = record.seq;
        enqueue(record);
      }
      await untilAborted(ctx.signal);
    } finally {
      clearInterval(keepalive);
      unsubscribe();
    }
  });
};

export const streamRoute = new Hono<AppEnv>().get('/', streamTransitions);
