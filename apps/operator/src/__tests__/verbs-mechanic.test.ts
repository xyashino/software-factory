import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli';
import type { Io, Verb } from '../verbs/define-verb';
import { incident } from '../verbs/mechanic/incident';
import { read } from '../verbs/mechanic/read';
import { startStubCell, type StubCell } from './stub-cell';

const TOKEN = 'x'.repeat(16);
const VERBS: readonly Verb[] = [read, incident];

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
  dir = mkdtempSync(join(tmpdir(), 'operator-mechanic-verbs-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await cell.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('mechanic verbs', () => {
  it('read sends only the verb and token', async () => {
    const code = await runCli(['read'], io(cell.url), VERBS);

    expect(code).toBe(0);
    expect(out).toEqual(['ok: true']);
    expect(cell.requests).toHaveLength(1);
    expect(bodyOf(0)).toEqual({ verb: 'read', token: TOKEN });
  });

  it.each(['retry_step', 'restart_from_scratch', 'escalate', 'cancel'])(
    'incident %s sends the action and report',
    async (action) => {
      const report = writeFile('report.md', 'the lock was stale\n');

      const code = await runCli(
        ['incident', '--action', action, '--report', report],
        io(cell.url),
        VERBS,
      );

      expect(code).toBe(0);
      expect(cell.requests).toHaveLength(1);
      expect(bodyOf(0)).toEqual({
        verb: 'incident',
        action,
        report: 'the lock was stale\n',
        token: TOKEN,
      });
    },
  );

  it('incident restart_from_step sends the step', async () => {
    const report = writeFile('report.md', 'retry from build\n');

    const code = await runCli(
      [
        'incident',
        '--action',
        'restart_from_step',
        '--step',
        'build',
        '--report',
        report,
      ],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(0);
    expect(bodyOf(0)).toMatchObject({
      action: 'restart_from_step',
      step: 'build',
    });
  });

  it('incident with an unknown action exits 2 and sends nothing', async () => {
    const report = writeFile('report.md', 'text\n');

    const code = await runCli(
      ['incident', '--action', 'nope', '--report', report],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('incident restart_from_step without step exits 2 and sends nothing', async () => {
    const report = writeFile('report.md', 'text\n');

    const code = await runCli(
      ['incident', '--action', 'restart_from_step', '--report', report],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(2);
    expect(err).toEqual(['invalid value for --step']);
    expect(cell.requests).toHaveLength(0);
  });

  it('incident without report exits 2 and sends nothing', async () => {
    const code = await runCli(
      ['incident', '--action', 'cancel'],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(2);
    expect(cell.requests).toHaveLength(0);
  });

  it('incident sends diagnosis and outcome when given', async () => {
    const report = writeFile('report.md', 'text\n');

    const code = await runCli(
      [
        'incident',
        '--action',
        'retry_step',
        '--diagnosis',
        'build ran out of memory',
        '--outcome',
        'raised the limit',
        '--report',
        report,
      ],
      io(cell.url),
      VERBS,
    );

    expect(code).toBe(0);
    expect(bodyOf(0)).toMatchObject({
      diagnosis: 'build ran out of memory',
      outcome: 'raised the limit',
    });
  });

  it('incident prints the refusal from the Cell and exits 1', async () => {
    const refused = await startStubCell({
      status: 409,
      body: '{"ok":false,"code":"stale_epoch","message":"epoch moved on"}',
    });
    const report = writeFile('report.md', 'text\n');

    const code = await runCli(
      ['incident', '--action', 'cancel', '--report', report],
      io(refused.url),
      VERBS,
    );
    await refused.close();

    expect(code).toBe(1);
    expect(err).toEqual(['stale_epoch: epoch moved on']);
  });
});
