import { describe, expect, it } from 'vitest';
import { renderCliCommands } from '../guide';

describe('CLI guide', () => {
  it('names done, ask and tell for a worker', () => {
    const lines = renderCliCommands('worker');
    expect(lines).toEqual([
      expect.stringMatching(/^- `sf done`: finish the step\./),
      expect.stringMatching(/^- `sf ask <operator\|human>/),
      expect.stringMatching(/^- `sf tell <step\|human>/),
    ]);
  });

  it('names the verdict, ask and tell commands for a judge', () => {
    const lines = renderCliCommands('judge');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^- `sf verdict pass`:/);
    expect(lines[1]).toMatch(/^- `sf verdict fail`:/);
    expect(lines[2]).toMatch(/^- `sf ask /);
    expect(lines[3]).toMatch(/^- `sf tell /);
  });

  it('names only done, answer, unblock and escalate for the operator', () => {
    const lines = renderCliCommands('operator');
    expect(lines.map((line) => /`sf (\w+)/.exec(line)?.[1])).toEqual([
      'done',
      'answer',
      'unblock',
      'escalate',
    ]);
  });
});
