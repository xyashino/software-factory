import { z } from 'zod';
import type { Permission, RunnerAdapter, TokenUsage } from './runner';

const outputSchema = z.object({
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

const modeArgs = (permission: Permission): string[] => {
  // Every run force-approves tool calls unattended; read mode also plans without edits.
  return permission === 'read' ? ['--mode', 'plan', '--force'] : ['--force'];
};

export const cursorRunner: RunnerAdapter = {
  name: 'cursor',
  kind: 'cursor',
  binary: 'cursor-agent',
  readOnly: true,
  startArgs: ({ model, permission = 'write' }) => [
    ...modeArgs(permission),
    '--trust',
    '--approve-mcps',
    '--model',
    model,
  ],
  headlessArgs: ({ model, permission, prompt }) => [
    '-p',
    ...modeArgs(permission),
    '--trust',
    '--approve-mcps',
    '--output-format',
    'json',
    '--model',
    model,
    prompt,
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
    };
  },
};
