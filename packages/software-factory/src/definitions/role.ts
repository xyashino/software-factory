import { basename } from 'node:path';
import { z } from 'zod';
import { templateVariables } from '../prompts/render';
import { parseYaml, splitFrontmatter } from './frontmatter';
import { zodErrors, type DefinitionError } from './errors';
import type { Result, Role } from './types';

/** Variables the supervisor always provides to a role prompt. */
export const BUILT_IN_VARIABLES = [
  'taskId',
  'attemptId',
  'artifactDir',
  'evidenceDir',
  'todoBody',
  'context',
] as const;

const KEBAB_ID = /^[a-z][a-z0-9-]*$/;
const CAMEL_KEY = /^[a-z][a-zA-Z0-9]*$/;
const JUDGE_FEEDBACK_FILE = 'feedback.md';

const catalogIds = (kind: string, example: string) => {
  return z
    .array(
      z
        .string()
        .regex(KEBAB_ID, `must be a kebab-case ${kind} id, like "${example}"`),
    )
    .default([])
    .refine(
      (ids) => new Set(ids).size === ids.length,
      `must not list a ${kind} twice`,
    );
};

const isPlainFileName = (name: string): boolean => {
  return name !== '.' && name !== '..' && /^[^/\\\0]+$/.test(name);
};

const roleFrontmatter = z
  .strictObject({
    id: z.string().regex(KEBAB_ID, 'must be kebab-case, like "plan-reviewer"'),
    label: z.string().trim().min(1, 'must not be empty'),
    verdict: z.boolean().default(false),
    rules: catalogIds('rule', 'rich-commit'),
    skills: catalogIds('skill', 'evidence'),
    artifacts: z.record(
      z.string(),
      z
        .string()
        .refine(isPlainFileName, 'must be a file name without directories'),
    ),
  })
  .superRefine((frontmatter, ctx) => {
    for (const key of Object.keys(frontmatter.artifacts)) {
      if (!CAMEL_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['artifacts', key],
          message: 'must be camelCase, like "plan"',
        });
      }
    }
    if (Object.keys(frontmatter.artifacts).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'must declare at least one artifact',
      });
    }
    if (
      frontmatter.verdict &&
      frontmatter.artifacts.feedback !== JUDGE_FEEDBACK_FILE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifacts', 'feedback'],
        message: `judging roles (verdict: true) must declare feedback: ${JUDGE_FEEDBACK_FILE}`,
      });
    }
  });

export interface Source {
  /** path relative to the package root, for error messages */
  file: string;
  /** absolute path, stored on the parsed role */
  path: string;
}

/**
 * Parses a role file: YAML frontmatter plus a prompt body. Every problem is
 * collected; the first one does not stop the check.
 */
export const parseRole = (
  source: Source,
  text: string,
): Result<Role, DefinitionError[]> => {
  const split = splitFrontmatter(text);
  if (split === null) {
    return {
      ok: false,
      error: [
        {
          file: source.file,
          field: 'frontmatter',
          message: 'missing frontmatter: the file must start with a --- block',
        },
      ],
    };
  }

  const yaml = parseYaml(source.file, split.frontmatter);
  if (!yaml.ok) {
    return yaml;
  }

  const parsed = roleFrontmatter.safeParse(yaml.value, { reportInput: true });
  if (!parsed.success) {
    return { ok: false, error: zodErrors(source.file, parsed.error) };
  }
  const frontmatter = parsed.data;

  const errors: DefinitionError[] = [];
  const expectedId = basename(source.file, '.md');
  if (frontmatter.id !== expectedId) {
    errors.push({
      file: source.file,
      field: 'id',
      message: `must equal the file name "${expectedId}"`,
    });
  }

  const allowed = new Set<string>([
    ...BUILT_IN_VARIABLES,
    ...Object.keys(frontmatter.artifacts).map((key) => `${key}Path`),
  ]);
  const used = new Set(templateVariables(split.body));

  for (const name of used) {
    if (!allowed.has(name)) {
      errors.push({
        file: source.file,
        field: 'template',
        message: `unknown variable {{${name}}}`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }

  return {
    ok: true,
    value: {
      id: frontmatter.id,
      label: frontmatter.label,
      verdict: frontmatter.verdict,
      rules: frontmatter.rules,
      skills: frontmatter.skills,
      artifacts: frontmatter.artifacts,
      body: split.body,
      path: source.path,
    },
  };
};
