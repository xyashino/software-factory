import { parse } from 'yaml';
import { z } from 'zod';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const OPERATOR_BINARY = /\bfactory-operator\b/g;
const DEFAULT_REPORT = 'report.md';
const DEFAULT_COMMIT = 'commit.txt';
const DEFAULT_PROFILE = [
  'Do task {{taskId}}. Read each input first:',
  '{{inputs}}',
  '',
  'Write `{{path}}{{report}}` (what changed) and `{{path}}{{commit}}` (a `type(scope): title` commit message).',
  'Do not commit or push. When finished, run `factory-operator done`.',
  '',
].join('\n');

const frontmatterSchema = z.looseObject({
  rules: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  artifacts: z.record(z.string(), z.string()).default({}),
});

export interface PromptInput {
  profile: string | null;
  taskId: string;
  attemptId: string;
  stepDir: string;
  evidenceDir: string;
  inputs: readonly string[];
  context: string;
  operatorCommand: string;
}

const bulletList = (items: readonly string[], empty: string): string =>
  items.length === 0 ? empty : items.map((item) => `- ${item}`).join('\n');

const metaOf = (profile: string) => {
  const match = FRONTMATTER.exec(profile);
  return {
    meta: frontmatterSchema.parse(match ? (parse(match[1] ?? '') ?? {}) : {}),
    body: match ? profile.slice(match[0].length) : profile,
  };
};

export const profileArtifacts = (profile: string): Record<string, string> =>
  metaOf(profile).meta.artifacts;

export const renderOperatorPrompt = (input: PromptInput): string => {
  const { meta, body } = metaOf(input.profile ?? DEFAULT_PROFILE);
  const vars: Record<string, string> = {
    taskId: input.taskId,
    attemptId: input.attemptId,
    inputs: bulletList(
      input.inputs.map((path) => `\`${path}\``),
      '- none',
    ),
    context: input.context.trim() === '' ? 'None.' : input.context,
    rules: bulletList(
      meta.rules.map((rule) => `${rule} (see \`CLAUDE.md\` / \`AGENTS.md\`)`),
      '- the rules in `CLAUDE.md`',
    ),
    skills: bulletList(
      meta.skills.map((skill) => `\`.agents/skills/${skill}/SKILL.md\``),
      '- none',
    ),
    evidenceDir: input.evidenceDir,
    path: `${input.stepDir}/`,
    report: DEFAULT_REPORT,
    commit: DEFAULT_COMMIT,
    ...meta.artifacts,
  };
  return body
    .replace(PLACEHOLDER, (whole, key: string) => vars[key] ?? whole)
    .replace(OPERATOR_BINARY, input.operatorCommand);
};
