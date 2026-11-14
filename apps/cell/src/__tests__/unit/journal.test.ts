import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openJournal } from '../../cycle/journal';
import { scratch } from '../helpers/git';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('runtime journal', () => {
  it('appends one JSON line per entry, creating the runtime directory', () => {
    const dir = scratch('journal');
    dirs.push(dir);
    const path = join(dir, 'runtime', 'cycle.jsonl');
    const journal = openJournal(path);

    journal({ at: 1, kind: 'pane_ready', headless: true });
    journal({ at: 2, kind: 'remind_idle' });

    const lines = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { at: 1, kind: 'pane_ready', headless: true },
      { at: 2, kind: 'remind_idle' },
    ]);
  });
});
