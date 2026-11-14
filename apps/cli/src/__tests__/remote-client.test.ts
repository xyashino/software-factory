import { afterEach, describe, expect, it } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CellId, JobId, OrderId } from '@repo/factory-core/ids';
import { fixtureEvents, SCENARIO_FIXTURES } from '@repo/factory-core/testing';
import { remoteFactoryClient } from '../client/remote';

/** A throwaway HTTP server on a free port, answering with the handler the test gives. */
let stop: (() => void) | undefined;

const serve = (
  handler: (request: Request) => Response | Promise<Response>,
): string => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler });
  stop = () => server.stop(true);
  return `http://127.0.0.1:${server.port}`;
};

afterEach(() => {
  stop?.();
  stop = undefined;
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('remote FactoryClient', () => {
  it('sends the token as a bearer and reads the route answer', async () => {
    let seen = '';
    const baseUrl = serve((request) => {
      seen = request.headers.get('authorization') ?? '';
      return json(200, { orders: [] });
    });
    const client = remoteFactoryClient({ baseUrl, token: 'tok-123' });

    const board = await client.call('board', {});

    expect(seen).toBe('Bearer tok-123');
    expect(board).toEqual({ orders: [] });
  });

  it('refuses a rejected token as unauthorized with status 401', async () => {
    const baseUrl = serve(() => json(401, { code: 'unauthorized' }));
    const client = remoteFactoryClient({ baseUrl, token: 'wrong' });

    const refused = client.call('board', {});

    await expect(refused).rejects.toBeInstanceOf(WireFailure);
    await expect(refused).rejects.toMatchObject({
      status: 401,
      error: { code: 'unauthorized' },
    });
  });

  it('keeps the wire error of a stale epoch', async () => {
    const baseUrl = serve(() => json(409, { code: 'stale_epoch', current: 4 }));
    const client = remoteFactoryClient({ baseUrl, token: 'tok' });

    await expect(
      client.call('submitCommand', {
        cellId: '01J0000000000000000000000W' as CellId,
        orderId: 'software-factory:todo-1' as OrderId,
        jobId: '01J0000000000000000000000J' as JobId,
        commandId: 'job:start',
        epoch: 1,
        command: { type: 'StartCycle', baseCommit: 'b'.repeat(40) as never },
      }),
    ).rejects.toMatchObject({
      status: 409,
      error: { code: 'stale_epoch', current: 4 },
    });
  });

  it('reads an empty claim as no job', async () => {
    const baseUrl = serve(() => new Response(null, { status: 204 }));
    const client = remoteFactoryClient({ baseUrl, token: 'tok' });

    const claim = await client.call('claim', {
      cellId: '01J0000000000000000000000W' as CellId,
      waitMs: 0,
    });

    expect(claim).toEqual({ job: null });
  });

  it('reports an unreachable server as unavailable', async () => {
    const closed = serve(() => json(200, {}));
    stop?.();
    stop = undefined;
    const client = remoteFactoryClient({ baseUrl: closed, token: 'tok' });

    await expect(client.call('board', {})).rejects.toMatchObject({
      error: { code: 'unavailable' },
    });
  });

  it('reads the feed from the SSE stream, from the cursor', async () => {
    let seenAfter = '';
    const baseUrl = serve((request) => {
      seenAfter = new URL(request.url).searchParams.get('after') ?? '';
      const frames = fixtureEvents(SCENARIO_FIXTURES[0]!)
        .slice(0, 2)
        .map(
          (stored) =>
            `id: ${stored.globalSeq}\ndata: ${JSON.stringify(stored)}\n\n`,
        );
      return new Response(frames.join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    const client = remoteFactoryClient({ baseUrl, token: 'tok' });

    const page = await client.call('supervisorEvents', {
      afterGlobalSeq: 0,
      waitMs: 0,
    });

    expect(seenAfter).toBe('0');
    const expected = fixtureEvents(SCENARIO_FIXTURES[0]!).slice(0, 2);
    expect(page.events).toEqual(expected);
    expect(page.nextSeq).toBe(expected.at(-1)?.globalSeq);
  });

  it('refuses the host-only backup over the network with a pointer to the host', async () => {
    const client = remoteFactoryClient({
      baseUrl: 'http://127.0.0.1:1',
      token: 'tok',
    });

    await expect(
      client.call('adminBackup', { file: '/tmp/x.db' }),
    ).rejects.toThrow(/runs on the Factory host/);
  });
});
