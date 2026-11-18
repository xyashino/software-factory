import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runCli } from '../cli';
import { defineVerb, type Io, type Verb } from '../verbs/define-verb';
import { startStubCell, type StubCell } from './stub-cell';

const TOKEN = 'x'.repeat(16);

let cell: StubCell;
let out: string[];
let err: string[];

const io = (env: Record<string, string | undefined>): Io => ({
  env,
  stdout: (line) => out.push(line),
  stderr: (line) => err.push(line),
});

const cellEnv = (url: string) => ({
  FACTORY_OPERATOR_URL: url,
  FACTORY_CYCLE_TOKEN: TOKEN,
});

const ping = defineVerb({
  name: 'ping',
  description: 'Send a ping to the Cell',
  args: z.object({ note: z.string().optional() }),
  readFiles: {},
  toRequest: ({ note }) => ({ verb: 'ping', note }),
});

const pong = defineVerb({
  name: 'pong',
  description: 'Answer a ping',
  args: z.object({}),
  readFiles: {},
  toRequest: () => ({ verb: 'pong' }),
});

const verbs: readonly Verb[] = [ping, pong];

beforeEach(async () => {
  cell = await startStubCell({ status: 200, body: '{"ok":true}' });
  out = [];
  err = [];
});

afterEach(async () => {
  await cell.close();
});

describe('operator CLI', () => {
  it('lists every registered verb in help', async () => {
    const code = await runCli(['--help'], io(cellEnv(cell.url)), verbs);

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('ping');
    expect(out.join('\n')).toContain('pong');
    expect(cell.requests).toHaveLength(0);
  });

  it('routes a verb to exactly one request', async () => {
    const code = await runCli(
      ['ping', '--note', 'hello'],
      io(cellEnv(cell.url)),
      verbs,
    );

    expect(code).toBe(0);
    expect(out).toEqual(['ok: true']);
    expect(cell.requests).toHaveLength(1);
    expect(JSON.parse(cell.requests[0]?.body ?? '')).toMatchObject({
      verb: 'ping',
      note: 'hello',
    });
  });

  it('refuses an unknown verb with exit 2 and no request', async () => {
    const code = await runCli(['launch'], io(cellEnv(cell.url)), verbs);

    expect(code).toBe(2);
    expect(err).toEqual(['unknown verb: launch']);
    expect(cell.requests).toHaveLength(0);
  });

  it('refuses an unknown option with exit 2 and no request', async () => {
    const code = await runCli(
      ['ping', '--bogus'],
      io(cellEnv(cell.url)),
      verbs,
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('exits 2 without a request when the endpoint env is missing', async () => {
    const code = await runCli(
      ['pong'],
      io({ FACTORY_CYCLE_TOKEN: TOKEN }),
      verbs,
    );

    expect(code).toBe(2);
    expect(err).toEqual(['FACTORY_OPERATOR_URL is not set']);
    expect(cell.requests).toHaveLength(0);
  });

  it('exits 3 when the Cell cannot be reached', async () => {
    const gone = await startStubCell({ status: 200, body: '{"ok":true}' });
    await gone.close();

    const code = await runCli(['pong'], io(cellEnv(gone.url)), verbs);

    expect(code).toBe(3);
    expect(err).toEqual(['endpoint unreachable']);
  });
});
