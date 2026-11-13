import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Paint } from '../../paint';
import { tick } from '../run';
import { harness, scratchRoot, todoText, type Harness } from './fixtures';

const ESC = '\u001b[';

const wrap =
  (open: string) =>
  (s: string): string =>
    `${ESC}${open}m${s}${ESC}0m`;

const ansi: Paint = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  blue: wrap('34'),
  gray: wrap('90'),
  magenta: wrap('35'),
};

const runTicks = async (h: Harness, paint?: Paint): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await tick(h.ports, () => undefined, paint);
  }
};

describe('task supervisor log', () => {
  it('keeps colour codes in the task log and the global log', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);

    await runTicks(h, ansi);

    const taskLog = readFileSync(
      join(root, '.evidences', 'hello', 'supervisor.log'),
      'utf8',
    );
    const globalLog = readFileSync(
      join(root, '.factory', 'supervisor.log'),
      'utf8',
    );
    expect(taskLog).toContain(ESC);
    expect(globalLog).toContain(ESC);
  });

  it('writes no colour codes when the painter is plain', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);

    await runTicks(h);

    const taskLog = readFileSync(
      join(root, '.evidences', 'hello', 'supervisor.log'),
      'utf8',
    );
    expect(taskLog.length).toBeGreaterThan(0);
    expect(taskLog).not.toContain(ESC);
  });
});
