import { describe, expect, it } from 'vitest';
import { toRequest } from '../cli';

describe('factory-operator incident and escalate', () => {
  it('turns incident flags into the verb, with each change', () => {
    expect(
      toRequest([
        'incident',
        '--diagnosis',
        'the pane was blocked by the trust screen',
        '--action',
        'repair',
        '--outcome',
        'the runner config now starts headless',
        '--change',
        'config:runners/claude.json=sha256:' + 'a'.repeat(64),
        '--change',
        'file:lines/factory-default.yaml=' + 'b'.repeat(40),
      ]),
    ).toEqual({
      op: 'incident',
      diagnosis: 'the pane was blocked by the trust screen',
      action: 'repair',
      outcome: 'the runner config now starts headless',
      changes: [
        {
          kind: 'config',
          path: 'runners/claude.json',
          ref: 'sha256:' + 'a'.repeat(64),
        },
        {
          kind: 'file',
          path: 'lines/factory-default.yaml',
          ref: 'b'.repeat(40),
        },
      ],
    });
  });

  it('refuses an unknown action and a malformed change', () => {
    expect(() =>
      toRequest([
        'incident',
        '--diagnosis',
        'x',
        '--action',
        'fix',
        '--outcome',
        'y',
      ]),
    ).toThrow('--action takes');
    expect(() =>
      toRequest([
        'incident',
        '--diagnosis',
        'x',
        '--action',
        'repair',
        '--outcome',
        'y',
        '--change',
        'runner.json',
      ]),
    ).toThrow('--change takes');
  });

  it('needs the diagnosis and the outcome for an escalate', () => {
    expect(
      toRequest([
        'escalate',
        '--diagnosis',
        'no safe repair',
        '--outcome',
        'tried twice',
      ]),
    ).toEqual({
      op: 'escalate',
      diagnosis: 'no safe repair',
      outcome: 'tried twice',
    });
    expect(() => toRequest(['escalate', '--outcome', 'tried'])).toThrow(
      '--diagnosis needs a value',
    );
  });
});
