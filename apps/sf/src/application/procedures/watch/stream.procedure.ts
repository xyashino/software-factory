import { z } from 'zod';
import { transitionDto } from '@repo/factory-contracts/stream.contract';
import { Refused, Unreachable } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';

const STREAM_ROUTE = '/api/v1/stream';
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

const WatchSchema = z
  .object({
    configPath: z.string().min(1),
    project: z.string().trim().min(1).optional(),
    afterSeq: z.number().int().min(0),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal),
    onTransition: z.custom<(transition: Transition) => void>(
      (value) => typeof value === 'function',
    ),
  })
  .strict();

type Transition = z.infer<typeof transitionDto>;

const backoffMs = (idleAttempts: number): number =>
  Math.min(BASE_DELAY_MS * 2 ** idleAttempts, MAX_DELAY_MS);

const parseTransition = (data: string): Transition => {
  try {
    return transitionDto.parse(JSON.parse(data));
  } catch {
    throw new Refused('server sent an unreadable transition event');
  }
};

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

export const streamTransitions = define({ kind: 'supervisor' })(
  WatchSchema,
)<void>(async (input, ctx) => {
  const projectId =
    input.project ?? (await readProjectId(ctx, input.configPath));
  const secret = await readSecret(ctx);
  let lastSeq = input.afterSeq;
  let idleAttempts = 0;
  while (!input.signal.aborted) {
    const seqBefore = lastSeq;
    try {
      for await (const frame of ctx.server.stream(
        STREAM_ROUTE,
        { projectId, afterSeq: String(lastSeq) },
        secret,
        input.signal,
      )) {
        const transition = parseTransition(frame.data);
        if (transition.seq <= lastSeq) {
          continue;
        }
        lastSeq = transition.seq;
        input.onTransition(transition);
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) {
        throw error;
      }
    }
    if (input.signal.aborted) {
      return;
    }
    const delay = backoffMs(idleAttempts);
    idleAttempts = lastSeq > seqBefore ? 0 : idleAttempts + 1;
    await Promise.race([ctx.clock.sleep(delay), untilAborted(input.signal)]);
  }
});
