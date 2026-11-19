import { parse } from 'yaml';
import { z } from 'zod';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const OPERATOR_COMMAND = 'bun apps/factory/src/cli.ts operator';
const NONE = 'none';
const DEFAULT_CONTEXT = 'The task is in the Task section below.';

const profileMetaSchema = z.object({
  rules: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  artifacts: z.record(z.string(), z.string()).default({}),
});

export interface PromptInput {
  profileText: string;
  taskId: string;
  attemptId: string;
  stepId: string;
  title: string;
  description: string;
  inputs: { ref: string; content: string }[];
  context: string | null;
}

const splitProfile = (
  text: string,
): { meta: z.infer<typeof profileMetaSchema>; body: string } => {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    return { meta: profileMetaSchema.parse({}), body: text };
  }
  const parsed = profileMetaSchema.safeParse(parse(match[1] ?? ''));
  return {
    meta: parsed.success ? parsed.data : profileMetaSchema.parse({}),
    body: text.slice(match[0].length),
  };
};

const bulletsOf = (items: string[]): string =>
  items.length === 0 ? NONE : items.map((item) => `- ${item}`).join('\n');

const inputsOf = (inputs: PromptInput['inputs']): string =>
  inputs.length === 0
    ? NONE
    : inputs.map(({ ref, content }) => `### ${ref}\n\n${content}`).join('\n\n');

export const artifactsOf = (profileText: string): Record<string, string> =>
  splitProfile(profileText).meta.artifacts;

export const renderOperatorPrompt = (input: PromptInput): string => {
  const { meta, body } = splitProfile(input.profileText);
  const values: Record<string, string> = {
    taskId: input.taskId,
    attemptId: input.attemptId,
    path: `.cell/${input.stepId}/`,
    inputs: inputsOf(input.inputs),
    context: input.context ?? DEFAULT_CONTEXT,
    rules: bulletsOf(meta.rules),
    skills: bulletsOf(meta.skills),
    ...meta.artifacts,
  };
  const rendered = body
    .replace(PLACEHOLDER, (whole, key: string) => values[key] ?? whole)
    .replaceAll('factory-operator', OPERATOR_COMMAND);
  return [
    rendered.trimEnd(),
    '',
    '## Task',
    '',
    `# ${input.title}`,
    '',
    input.description,
    '',
    '## Report',
    '',
    `Report the step with \`${OPERATOR_COMMAND} done\`, or \`${OPERATOR_COMMAND} verdict\` and \`${OPERATOR_COMMAND} block\` where the step asks for them.`,
    '',
  ].join('\n');
};
