import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineVerb, type Io } from '../verbs/define-verb';
import { startStubCell, type StubCell } from './stub-cell';

const TOKEN = 'x'.repeat(16);

let cell: StubCell;
let dir: string;
let out: string[];
let err: string[];

const io = (url: string): Io => ({
  env: { FACTORY_OPERATOR_URL: url, FACTORY_CYCLE_TOKEN: TOKEN },
  stdout: (line) => out.push(line),
  stderr: (line) => err.push(line),
});

const ok = { status: 200, body: '{"ok":true}' };

beforeEach(async () => {
  cell = await startStubCell(ok);
  dir = mkdtempSync(join(tmpdir(), 'operator-verb-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await cell.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('defineVerb', () => {
  it('sends one request for a verb without files', async () => {
    const ping = defineVerb({
      name: 'ping',
      description: 'Send a ping',
      args: z.object({}),
      readFiles: {},
      toRequest: () => ({ verb: 'ping' }),
    });

    const code = await ping.run([], io(cell.url));

    expect(code).toBe(0);
    expect(out).toEqual(['ok: true']);
    expect(cell.requests).toHaveLength(1);
  });

  it('sends the file contents read from a required file', async () => {
    const path = join(dir, 'feedback.md');
    writeFileSync(path, 'fix the parser\n', 'utf8');
    const verdict = defineVerb({
      name: 'verdict',
      description: 'Record a verdict',
      args: z.object({ result: z.enum(['pass', 'fail']) }),
      readFiles: { feedback: { required: true } },
      toRequest: ({ result }, files) => ({
        verb: 'verdict',
        result,
        feedback: files.feedback,
      }),
    });

    const code = await verdict.run(
      ['--result', 'fail', '--feedback', path],
      io(cell.url),
    );

    expect(code).toBe(0);
    expect(JSON.parse(cell.requests[0]?.body ?? '')).toMatchObject({
      verb: 'verdict',
      result: 'fail',
      feedback: 'fix the parser\n',
    });
  });

  it('gives exit 2 and sends nothing when a required file is missing', async () => {
    const verdict = defineVerb({
      name: 'verdict',
      description: 'Record a verdict',
      args: z.object({}),
      readFiles: { feedback: { required: true } },
      toRequest: () => ({ verb: 'verdict' }),
    });

    const code = await verdict.run(
      ['--feedback', join(dir, 'missing.md')],
      io(cell.url),
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('gives exit 2 and sends nothing when a required flag is absent', async () => {
    const verdict = defineVerb({
      name: 'verdict',
      description: 'Record a verdict',
      args: z.object({ result: z.enum(['pass', 'fail']) }),
      readFiles: {},
      toRequest: ({ result }) => ({ verb: 'verdict', result }),
    });

    const code = await verdict.run([], io(cell.url));

    expect(code).toBe(2);
    expect(err).toEqual(['invalid value for --result']);
    expect(cell.requests).toHaveLength(0);
  });

  it('gives exit 2 and sends nothing when an enum value is unknown', async () => {
    const verdict = defineVerb({
      name: 'verdict',
      description: 'Record a verdict',
      args: z.object({ result: z.enum(['pass', 'fail']) }),
      readFiles: {},
      toRequest: ({ result }) => ({ verb: 'verdict', result }),
    });

    const code = await verdict.run(['--result', 'maybe'], io(cell.url));

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('gives exit 2 and sends nothing when an unknown option is passed', async () => {
    const ping = defineVerb({
      name: 'ping',
      description: 'Send a ping',
      args: z.object({}),
      readFiles: {},
      toRequest: () => ({ verb: 'ping' }),
    });

    const code = await ping.run(['--surprise', 'yes'], io(cell.url));

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('prints the refusal code and message on stderr', async () => {
    const refused = await startStubCell({
      status: 409,
      body: '{"ok":false,"code":"stale_epoch","message":"epoch moved on"}',
    });
    const ping = defineVerb({
      name: 'ping',
      description: 'Send a ping',
      args: z.object({}),
      readFiles: {},
      toRequest: () => ({ verb: 'ping' }),
    });

    const code = await ping.run([], io(refused.url));
    await refused.close();

    expect(code).toBe(1);
    expect(err).toEqual(['stale_epoch: epoch moved on']);
    expect(out).toEqual([]);
  });

  it('lists every flag the verb accepts', () => {
    const verdict = defineVerb({
      name: 'verdict',
      description: 'Record a verdict',
      args: z.object({
        result: z.enum(['pass', 'fail']),
        reasonText: z.string().optional(),
      }),
      readFiles: { feedback: { required: false } },
      toRequest: ({ result }) => ({ verb: 'verdict', result }),
    });

    expect(verdict.options).toEqual([
      { flag: '--result', required: true },
      { flag: '--reason-text', required: false },
      { flag: '--feedback', required: false },
    ]);
  });
});
