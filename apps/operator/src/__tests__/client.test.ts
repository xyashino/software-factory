import { afterEach, describe, expect, it } from 'vitest';
import { lineFor, type Result } from '../exit-codes';
import { sendRequest, type Env } from '../client';
import { startStubCell, type Reply, type StubCell } from './stub-cell';

const TOKEN = 'token-0123456789abcdef';
const TIMEOUT_MS = 200;

const cells: StubCell[] = [];

const startCell = async (reply: Reply): Promise<StubCell> => {
  const cell = await startStubCell(reply);
  cells.push(cell);
  return cell;
};

const envFor = (url: string): Env => ({
  FACTORY_OPERATOR_URL: url,
  FACTORY_CYCLE_TOKEN: TOKEN,
});

const reply = (status: number, body: unknown): Reply => ({
  status,
  body: JSON.stringify(body),
});

afterEach(async () => {
  await Promise.all(cells.splice(0).map((cell) => cell.close()));
});

describe('client', () => {
  it('returns ok when the cell accepts the request', async () => {
    const cell = await startCell(reply(200, { ok: true }));

    const result = await sendRequest({ verb: 'done' }, envFor(cell.url));

    expect(result).toEqual({ kind: 'ok' });
  });

  it('sends the verb and token as one JSON body', async () => {
    const cell = await startCell(reply(200, { ok: true }));

    await sendRequest({ verb: 'done' }, envFor(cell.url));

    expect(cell.requests).toEqual([
      {
        method: 'POST',
        path: '/',
        body: JSON.stringify({ verb: 'done', token: TOKEN }),
      },
    ]);
  });

  it.each([
    [400, 'invalid', 'bad field'],
    [401, 'unauthorized', 'no such token'],
    [409, 'stale_epoch', 'epoch moved on'],
    [500, 'internal', 'boom'],
  ])(
    'returns refused with the reply code and message on %i',
    async (status, code, message) => {
      const cell = await startCell(reply(status, { ok: false, code, message }));

      const result = await sendRequest({ verb: 'done' }, envFor(cell.url));

      expect(result).toEqual({ kind: 'refused', code, message });
    },
  );

  it('returns unreachable when nothing listens on the endpoint', async () => {
    const closed = await startStubCell(reply(200, { ok: true }));
    await closed.close();

    const result = await sendRequest({ verb: 'done' }, envFor(closed.url));

    expect(result.kind).toBe('unreachable');
  });

  it('returns unreachable when the cell does not answer in time', async () => {
    const cell = await startCell('hang');

    const result = await sendRequest(
      { verb: 'done' },
      envFor(cell.url),
      TIMEOUT_MS,
    );

    expect(result.kind).toBe('unreachable');
  });

  it('returns unreachable when the reply is not JSON', async () => {
    const cell = await startCell({ status: 200, body: 'not json' });

    const result = await sendRequest({ verb: 'done' }, envFor(cell.url));

    expect(result.kind).toBe('unreachable');
  });

  it('returns unreachable when the reply shape does not match its status', async () => {
    const cell = await startCell(reply(200, { ok: false, code: 'internal' }));

    const result = await sendRequest({ verb: 'done' }, envFor(cell.url));

    expect(result.kind).toBe('unreachable');
  });

  it('returns unreachable on a status the protocol does not define', async () => {
    const cell = await startCell(reply(503, { ok: false }));

    const result = await sendRequest({ verb: 'done' }, envFor(cell.url));

    expect(result.kind).toBe('unreachable');
  });

  it('sends exactly one request when the cell is unreachable', async () => {
    const cell = await startCell('hang');

    await sendRequest({ verb: 'done' }, envFor(cell.url), TIMEOUT_MS);

    expect(cell.requests).toHaveLength(1);
  });

  it('sends nothing when the endpoint variable is missing', async () => {
    const cell = await startCell(reply(200, { ok: true }));

    const result = await sendRequest(
      { verb: 'done' },
      { FACTORY_CYCLE_TOKEN: TOKEN },
    );

    expect(result.kind).toBe('argument_error');
    expect(cell.requests).toHaveLength(0);
  });

  it('sends nothing when the token variable is missing', async () => {
    const cell = await startCell(reply(200, { ok: true }));

    const result = await sendRequest(
      { verb: 'done' },
      { FACTORY_OPERATOR_URL: cell.url },
    );

    expect(result.kind).toBe('argument_error');
    expect(cell.requests).toHaveLength(0);
  });

  it('sends nothing when the endpoint is not a URL', async () => {
    const result = await sendRequest(
      { verb: 'done' },
      { FACTORY_OPERATOR_URL: 'not a url', FACTORY_CYCLE_TOKEN: TOKEN },
    );

    expect(result.kind).toBe('argument_error');
  });

  it.each<[string, () => Promise<Result>]>([
    [
      'refused',
      async () => {
        const cell = await startCell(
          reply(401, { ok: false, code: 'unauthorized', message: 'no' }),
        );
        return sendRequest({ verb: 'done' }, envFor(cell.url));
      },
    ],
    [
      'unreachable',
      async () => {
        const cell = await startCell('hang');
        return sendRequest({ verb: 'done' }, envFor(cell.url), TIMEOUT_MS);
      },
    ],
    [
      'argument error',
      async () => sendRequest({ verb: 'done' }, { FACTORY_CYCLE_TOKEN: TOKEN }),
    ],
  ])('never prints the token on a %s result', async (_name, run) => {
    const result = await run();

    expect(lineFor(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
