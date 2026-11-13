import { describe, expect, it } from 'vitest';
import { RUNNERS } from '../../../definitions/workflow';
import { getRunner, RUNNER_NAMES, unregisteredRunners } from '../registry';

const CLAUDE_READ_DENIED = 'Write,Edit,MultiEdit,NotebookEdit';

describe('runner registry', () => {
  it('registers exactly the runner names the workflow schema accepts', () => {
    expect([...RUNNER_NAMES].sort()).toEqual([...RUNNERS].sort());
  });

  it('maps each runner to a Herdr kind and passes the model through', () => {
    expect(getRunner('claude')).toMatchObject({ kind: 'claude' });
    expect(getRunner('antigravity')).toMatchObject({ kind: 'agy' });
    expect(getRunner('claude')?.startArgs({ model: 'sonnet' })).toEqual([
      '--dangerously-skip-permissions',
      '--model',
      'sonnet',
    ]);
  });

  it('grants read access to extra directories before the model flag', () => {
    expect(
      getRunner('claude')?.startArgs({
        model: 'haiku',
        addDirs: ['/repo/.evidences'],
      }),
    ).toEqual([
      '--dangerously-skip-permissions',
      '--add-dir',
      '/repo/.evidences',
      '--model',
      'haiku',
    ]);
  });

  it('starts a read-only pane with each runner own permission flags', () => {
    const options = { model: 'm', permission: 'read' } as const;
    expect(getRunner('claude')?.startArgs(options)).toEqual([
      '--dangerously-skip-permissions',
      '--disallowedTools',
      CLAUDE_READ_DENIED,
      '--model',
      'm',
    ]);
    expect(getRunner('codex')?.startArgs(options)).toEqual([
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'never',
      '-m',
      'm',
    ]);
    expect(getRunner('cursor')?.startArgs(options)).toEqual([
      '--mode',
      'plan',
      '--force',
      '--trust',
      '--approve-mcps',
      '--model',
      'm',
    ]);
    expect(getRunner('antigravity')?.startArgs(options)).toEqual([
      '--mode',
      'auto',
      '--dangerously-skip-permissions',
      '--model',
      'm',
    ]);
  });

  it('builds a headless run per runner, read-only and writable', () => {
    const base = { model: 'm', prompt: 'go', addDirs: ['/e'] } as const;
    expect(
      getRunner('claude')?.headlessArgs?.({ ...base, permission: 'read' }),
    ).toEqual([
      '-p',
      'go',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      CLAUDE_READ_DENIED,
      '--add-dir',
      '/e',
      '--output-format',
      'json',
      '--model',
      'm',
    ]);
    expect(
      getRunner('claude')?.headlessArgs?.({ ...base, permission: 'write' }),
    ).toEqual([
      '-p',
      'go',
      '--dangerously-skip-permissions',
      '--add-dir',
      '/e',
      '--output-format',
      'json',
      '--model',
      'm',
    ]);
    expect(
      getRunner('codex')?.headlessArgs?.({ ...base, permission: 'read' }),
    ).toEqual([
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--json',
      '-m',
      'm',
      'go',
    ]);
    expect(
      getRunner('codex')?.headlessArgs?.({ ...base, permission: 'write' }),
    ).toEqual([
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '-m',
      'm',
      'go',
    ]);
    expect(
      getRunner('cursor')?.headlessArgs?.({ ...base, permission: 'read' }),
    ).toEqual([
      '-p',
      '--mode',
      'plan',
      '--force',
      '--trust',
      '--approve-mcps',
      '--output-format',
      'json',
      '--model',
      'm',
      'go',
    ]);
    expect(
      getRunner('cursor')?.headlessArgs?.({ ...base, permission: 'write' }),
    ).toContain('--force');
    expect(
      getRunner('antigravity')?.headlessArgs?.({ ...base, permission: 'read' }),
    ).toEqual([
      '--mode',
      'auto',
      '--dangerously-skip-permissions',
      '--add-dir',
      '/e',
      '--output-format',
      'json',
      '--model',
      'm',
      '-p',
      'go',
    ]);
  });

  it('has no print mode and no read mode for opencode', () => {
    expect(getRunner('opencode')?.headlessArgs).toBeUndefined();
    expect(getRunner('opencode')?.readOnly).toBe(false);
  });

  it('reads tokens and cost from claude json output', () => {
    const stdout = JSON.stringify({
      result: 'ok',
      usage: { input_tokens: 120, output_tokens: 30 },
      total_cost_usd: 0.0123,
    });
    expect(getRunner('claude')?.parseUsage?.(stdout)).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.0123,
    });
  });

  it('reads tokens from the codex jsonl stream', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
      'not json',
      '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}',
    ].join('\n');
    expect(getRunner('codex')?.parseUsage?.(stdout)).toEqual({
      inputTokens: 15,
      outputTokens: 3,
    });
  });

  it('reads tokens from cursor and antigravity json output', () => {
    const stdout = JSON.stringify({
      usage: { input_tokens: 7, output_tokens: 8 },
    });
    expect(getRunner('cursor')?.parseUsage?.(stdout)).toEqual({
      inputTokens: 7,
      outputTokens: 8,
    });
    expect(getRunner('antigravity')?.parseUsage?.(stdout)).toEqual({
      inputTokens: 7,
      outputTokens: 8,
    });
  });

  it('reports no usage when the output is not the runner json', () => {
    expect(getRunner('claude')?.parseUsage?.('plain text')).toBeUndefined();
    expect(getRunner('claude')?.parseUsage?.('{"usage":{}}')).toBeUndefined();
    expect(getRunner('codex')?.parseUsage?.('')).toBeUndefined();
  });

  it('reports runners without an adapter', () => {
    expect(unregisteredRunners(['claude', 'gemini'])).toEqual(['gemini']);
  });
});
