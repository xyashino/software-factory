import { z } from 'zod';
import type { Permission, RunnerAdapter, TokenUsage } from './runner';

const outputSchema = z.object({
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
  total_cost_usd: z.number().optional(),
});

/**
 * Read mode runs in auto mode (the classifier approves safe calls and only
 * prompts for risky ones, as in write mode) with file writes denied outright,
 * so a judge cannot edit files but is not stalled by approval prompts.
 */
const READ_DENIED_TOOLS = 'Write,Edit,MultiEdit,NotebookEdit';

const permissionArgs = (permission: Permission): string[] => {
  return permission === 'read'
    ? ['--permission-mode', 'auto', '--disallowedTools', READ_DENIED_TOOLS]
    : ['--permission-mode', 'auto'];
};

const dirArgs = (addDirs: readonly string[]): string[] => {
  return addDirs.length > 0 ? ['--add-dir', ...addDirs] : [];
};

export const claudeRunner: RunnerAdapter = {
  name: 'claude',
  kind: 'claude',
  binary: 'claude',
  readOnly: true,
  startArgs: ({ model, addDirs = [], permission = 'write' }) => [
    ...permissionArgs(permission),
    ...dirArgs(addDirs),
    '--model',
    model,
  ],
  headlessArgs: ({ model, permission, prompt, addDirs }) => [
    '-p',
    prompt,
    ...permissionArgs(permission),
    ...dirArgs(addDirs),
    '--output-format',
    'json',
    '--model',
    model,
  ],
  parseUsage: (stdout): TokenUsage | undefined => {
    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {
      return undefined;
    }
    const parsed = outputSchema.safeParse(json);
    if (!parsed.success) return undefined;
    return {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
      ...(parsed.data.total_cost_usd === undefined
        ? {}
        : { costUsd: parsed.data.total_cost_usd }),
    };
  },
};
