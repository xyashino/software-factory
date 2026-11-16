import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import {
  createWorld,
  orderOf,
  statusOf,
  todo,
  until,
  type World,
} from './harness/world';
import type { HttpProxy, ProxiedRequest } from './harness/tcp-proxy';

const TODO = 'add-login';

const worlds: World[] = [];

afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

/** A Work order's trace without its ids: the event types in order, and the Station of each Cycle. */
const traceOf = (events: StoredEvent[]): string[] =>
  events.map((stored) => {
    const event = stored.event;
    if (event.type === 'cycle_started')
      return `cycle_started:${event.stationId}`;
    return event.type;
  });

/** The job-ending commands: the ones whose answer carries a continuation (PROTOCOL §4). */
const JOB_ENDING =
  /"type":"(CompleteCycle|SubmitVerdict|ReportInspection|ReportDelivery)"/;

/** Runs one Work order through one remote Cell; `faults` arms the proxy before the Cell starts. */
const runOnce = async (
  faults: ((proxy: HttpProxy) => void) | undefined,
): Promise<{ w: World; proxy: HttpProxy }> => {
  const w = await createWorld({ [TODO]: todo('Add login') });
  worlds.push(w);
  const remoteUrl = w.factory.remoteUrl;
  if (remoteUrl === undefined)
    throw new Error('the remote listener did not start');
  const proxy = w.proxyFor(remoteUrl);
  faults?.(proxy);
  await w.cell('cell-a', {
    factoryUrl: proxy.url,
    joinToken: await w.joinToken(),
  });
  await until(
    async () => (await statusOf(w, TODO)) === 'delivered',
    'the Work order to be delivered',
    90_000,
  );
  return { w, proxy };
};

/** A job-ending command, once per commandId: its answer is lost, and the Cell's retry gets through. */
const lostOnce = (): ((request: ProxiedRequest) => boolean) => {
  const lost = new Set<string>();
  return (request) => {
    if (!request.path.endsWith('/commands') || !JOB_ENDING.test(request.body)) {
      return false;
    }
    const commandId = JSON.parse(request.body).commandId as string;
    if (lost.has(commandId)) return false;
    lost.add(commandId);
    return true;
  };
};

const isJobEnding = (request: ProxiedRequest): boolean =>
  request.path.endsWith('/commands') && JOB_ENDING.test(request.body);

describe('responses lost on the way to a remote Cell', () => {
  it('delivers the Work order once, with the same trace as a run without faults', async () => {
    const clean = await runOnce(undefined);
    const faulty = await runOnce((proxy) => {
      // The Factory acts on each job-ending command, then its answer is lost. The Cell retries the same
      // commandId, and the stored answer carries the continuation the Cell runs next.
      proxy.dropResponses(lostOnce(), 4);
    });

    const cleanEvents = await clean.w.eventsOf(orderOf(TODO));
    const faultyEvents = await faulty.w.eventsOf(orderOf(TODO));

    // The same events, in the same order: nothing duplicated, nothing lost.
    expect(traceOf(faultyEvents)).toEqual(traceOf(cleanEvents));

    // Each continuation was claimed once, and the delivery happened once.
    const claims = (events: StoredEvent[]) =>
      events.filter((stored) => stored.event.type === 'job_claimed').length;
    expect(claims(faultyEvents)).toBe(claims(cleanEvents));
    expect(
      faultyEvents.filter(
        (stored) => stored.event.type === 'delivery_finished',
      ),
    ).toHaveLength(1);

    // The faults happened: some job-ending command was sent twice with the same commandId.
    const sentTwice = faulty.proxy.seen
      .filter(isJobEnding)
      .map((request) => JSON.parse(request.body).commandId as string)
      .filter((id, index, all) => all.indexOf(id) !== index);
    expect(sentTwice.length).toBeGreaterThan(0);
  }, 240_000);
});
