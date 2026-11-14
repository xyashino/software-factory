import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { SocketUnreachable, socketFactoryClient } from '../client/socket';

let dir: string;
const servers: { stop(force?: boolean): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-socket-'));
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const COMMAND_ID = '01J0000000000000000000ABCD';

/** A fake server on a temp socket: the first `failures` answers are 500, then a valid nudge result. */
const fakeServer = (failures: number) => {
  const bodies: { commandId: string }[] = [];
  let answered = 0;
  const server = Bun.serve({
    unix: join(dir, 'factory.sock'),
    fetch: async (request) => {
      bodies.push((await request.json()) as { commandId: string });
      answered += 1;
      if (answered <= failures) {
        return new Response('{"code":"unavailable"}', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ dryRun: false, events: [], next: null }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  });
  servers.push(server);
  return { bodies };
};

describe('socket client', () => {
  it('sends the same commandId on every retry of one call', async () => {
    const fake = fakeServer(2);
    const client = socketFactoryClient({
      socketPath: join(dir, 'factory.sock'),
      attempts: 3,
      retryDelayMs: 1,
    });

    const result = await client.call('nudge', {
      orderId: 'software-factory:todo-a' as never,
      commandId: COMMAND_ID,
      text: 'hello',
    });

    expect(result.events).toEqual([]);
    expect(fake.bodies).toHaveLength(3);
    expect(new Set(fake.bodies.map((body) => body.commandId))).toEqual(
      new Set([COMMAND_ID]),
    );
  });

  it('reports a server error as the server answered it, not as an unreachable socket', async () => {
    fakeServer(5);
    const client = socketFactoryClient({
      socketPath: join(dir, 'factory.sock'),
      attempts: 2,
      retryDelayMs: 1,
    });

    const failure = await client
      .call('board', {})
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WireFailure);
    expect((failure as WireFailure).error).toEqual({ code: 'unavailable' });
  });

  it('reports a missing socket as unreachable, so the transport can fall back', async () => {
    const client = socketFactoryClient({
      socketPath: join(dir, 'nothing-here.sock'),
      attempts: 2,
      retryDelayMs: 1,
    });

    const failure = await client
      .call('board', {})
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SocketUnreachable);
  });

  it('refuses a request its schema does not accept before sending it', async () => {
    const client = socketFactoryClient({
      socketPath: join(dir, 'factory.sock'),
      attempts: 1,
    });

    await expect(
      client.call('cellRevoke', { cellId: 'not-a-ulid' } as never),
    ).rejects.toThrow();
  });
});
