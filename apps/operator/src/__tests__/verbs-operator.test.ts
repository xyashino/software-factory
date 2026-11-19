import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli';
import type { Io, Verb } from '../verbs/define-verb';
import { block } from '../verbs/operator/block';
import { done } from '../verbs/operator/done';
import { verdict } from '../verbs/operator/verdict';
import { startStubCell, type StubCell } from './stub-cell';

const TOKEN = 'x'.repeat(16);
const VERBS: readonly Verb[] = [done, verdict, block];

let cell: StubCell;
let dir: string;
let out: string[];
let err: string[];

const io = (url: string): Io => ({
  env: { FACTORY_OPERATOR_URL: url, FACTORY_CYCLE_TOKEN: TOKEN },
  stdout: (line) => out.push(line),
  stderr: (line) => err.push(line),
});

const bodyOf = (index: number): Record<string, unknown> =>
  JSON.parse(cell.requests[index]?.body ?? '{}');

const writeFile = (name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text, 'utf8');
  return path;
};

beforeEach(async () => {
  cell = await startStubCell({ status: 200, body: '{"ok":true}' });
  dir = mkdtempSync(join(tmpdir(), 'operator-operator-verbs-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await cell.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('operator verbs', () => {
  it('done sends one request and prints ok', async () => {
    const code = await runCli(['done'], io(cell.url), VERBS);

    expect(code).toBe(0);
    expect(out).toEqual(['ok: true']);
    expect(cell.requests).toHaveLength(1);
    expect(bodyOf(0)).toMatchObject({ verb: 'done', token: TOKEN });
  });

  it('done prints the refusal from the Cell and exits 1', async () => {
    const refused = await startStubCell({
      status: 409,
      body: '{"ok":false,"code":"stale_epoch","message":"epoch moved on"}',
    });

    const code = await runCli(['done'], io(refused.url), VERBS);
    await refused.close();

    expect(code).toBe(1);
    expect(err).toEqual(['stale_epoch: epoch moved on']);
  });

  it('verdict pass sends one pass request', async () => {
    const code = await runCli(['verdict', 'pass'], io(cell.url), VERBS);

    expect(code).toBe(0);
    expect(out).toEqual(['ok: true']);
    expect(cell.requests).toHaveLength(1);
    expect(bodyOf(0)).toMatchObject({ verb: 'verdict', result: 'pass' });
  });

  it('verdict fail sends the feedback file text', async () => {
    const path = writeFile('feedback.md', 'fix the parser\n');

    const code = await runCli(
      ['verdict', 'fail', '--feedback', path],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(0);
    expect(bodyOf(0)).toMatchObject({
      verb: 'verdict',
      result: 'fail',
      feedback: 'fix the parser\n',
    });
  });

  it('verdict fail without feedback exits 2 and sends nothing', async () => {
    const code = await runCli(['verdict', 'fail'], io(cell.url), VERBS);

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('verdict without a subcommand exits 2 and sends nothing', async () => {
    const code = await runCli(['verdict'], io(cell.url), VERBS);

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('verdict with an unknown subcommand exits 2 and sends nothing', async () => {
    const code = await runCli(['verdict', 'maybe'], io(cell.url), VERBS);

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('block sends the reason and handover text', async () => {
    const path = writeFile('handover.md', 'stuck on migration\n');

    const code = await runCli(
      ['block', '--reason', 'schema drift', '--handover', path],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(0);
    expect(bodyOf(0)).toMatchObject({
      verb: 'block',
      reason: 'schema drift',
      handover: 'stuck on migration\n',
    });
  });

  it('block without reason exits 2 and sends nothing', async () => {
    const path = writeFile('handover.md', 'notes\n');

    const code = await runCli(
      ['block', '--handover', path],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('block without handover exits 2 and sends nothing', async () => {
    const code = await runCli(
      ['block', '--reason', 'schema drift'],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('block exits 3 when the Cell cannot be reached', async () => {
    const gone = await startStubCell({ status: 200, body: '{"ok":true}' });
    await gone.close();
    const path = writeFile('handover.md', 'notes\n');

    const code = await runCli(
      ['block', '--reason', 'schema drift', '--handover', path],
      io(gone.url),
      VERBS,
    );

    expect(code).toBe(3);
    expect(err).toEqual(['endpoint unreachable']);
  });
});
