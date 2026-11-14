import { z } from 'zod';
import type { Permission, RunnerAdapter, TokenUsage } from './runner';

const turnSchema = z.object({
  type: z.literal('turn.completed'),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

/** `--ask-for-approval` is a top-level flag; `codex exec` rejects it, so it goes before `exec`. */
const readFlags = (permission: Permission): string[] => {
  return permission === 'read'
    ? ['--sandbox', 'read-only', '--ask-for-approval', 'never']
    : ['--dangerously-bypass-approvals-and-sandbox'];
};

export const codexRunner: RunnerAdapter = {
  name: 'codex',
  kind: 'codex',
  binary: 'codex',
  readOnly: true,
  startArgs: ({ model, permission = 'write' }) => [
    ...readFlags(permission),
    '-m',
    model,
  ],
  headlessArgs: ({ model, permission, prompt }) => [
    ...(permission === 'read' ? ['--ask-for-approval', 'never'] : []),
    'exec',
    ...(permission === 'read'
      ? ['--sandbox', 'read-only']
      : ['--dangerously-bypass-approvals-and-sandbox']),
    '--json',
    '-m',
    model,
    prompt,
  ],
  parseUsage: (stdout): TokenUsage | undefined => {
    let usage: TokenUsage | undefined;
    for (const line of stdout.split('\n')) {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = turnSchema.safeParse(json);
      if (parsed.success) {
        usage = {
          inputTokens:
            (usage?.inputTokens ?? 0) + parsed.data.usage.input_tokens,
          outputTokens:
            (usage?.outputTokens ?? 0) + parsed.data.usage.output_tokens,
        };
      }
    }
    return usage;
  },
};
