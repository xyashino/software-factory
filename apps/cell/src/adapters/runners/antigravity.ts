import { z } from 'zod';
import type { RunnerAdapter, TokenUsage } from './runner';

const outputSchema = z.object({
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

const dirArgs = (addDirs: readonly string[]): string[] => {
  return addDirs.flatMap((dir) => ['--add-dir', dir]);
};

export const antigravityRunner: RunnerAdapter = {
  name: 'antigravity',
  kind: 'agy',
  binary: 'agy',
  readOnly: true,
  startArgs: ({ model, addDirs = [] }) => [
    '--mode',
    'auto',
    '--dangerously-skip-permissions',
    ...dirArgs(addDirs),
    '--model',
    model,
  ],
  headlessArgs: ({ model, prompt, addDirs }) => [
    '--mode',
    'auto',
    '--dangerously-skip-permissions',
    ...dirArgs(addDirs),
    '--output-format',
    'json',
    '--model',
    model,
    '-p',
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
