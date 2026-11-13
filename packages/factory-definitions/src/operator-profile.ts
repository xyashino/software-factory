import { basename } from 'node:path';
import { z } from 'zod';
import { err, ok, type Result } from '@repo/factory-core/result';
import { zodErrors, type DefinitionError } from './errors';
import { parseYaml, splitFrontmatter } from './frontmatter';
import { templateVariables } from './templates';

/** Variables the supervisor always provides to an operator prompt. */
export const BUILT_IN_VARIABLES = [
  'taskId',
  'attemptId',
  'artifactDir',
  'evidenceDir',
  'todoBody',
  'context',
] as const;

/** Where a profile file came from: relative for messages, absolute for reading. */
export interface Source {
  /** path relative to the package root, for error messages */
  file: string;
  /** absolute path, stored on the parsed profile */
  path: string;
}

/**
 * An Operator profile: who works at a Station and which files it hands over.
 * Lives in `operators/<id>.md`; a Line refers to it through an operator pool.
 */
export interface OperatorProfile {
  id: string;
  label: string;
  verdict: boolean;
  /** rule or group ids declared in `.nitpick/config.ts` */
  rules: string[];
  /** skill ids: `.nitpick/skills/<id>/SKILL.md` */
  skills: string[];
  /** key -> plain file name written into the attempt directory */
  artifacts: Record<string, string>;
  /** prompt body, without frontmatter */
  body: string;
  /** absolute path of the profile file */
  path: string;
}

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

const profileFrontmatter = z
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
        message: `judging profiles (verdict: true) must declare feedback: ${JUDGE_FEEDBACK_FILE}`,
      });
    }
  });

/**
 * Parses an operator profile: YAML frontmatter plus a prompt body. Every
 * problem is collected; the first one does not stop the check.
 */
export const parseOperatorProfile = (
  source: Source,
  text: string,
): Result<OperatorProfile, DefinitionError[]> => {
  const split = splitFrontmatter(text);
  if (split === null) {
    return err([
      {
        file: source.file,
        field: 'frontmatter',
        message: 'missing frontmatter: the file must start with a --- block',
      },
    ]);
  }

  const yaml = parseYaml(source.file, split.frontmatter);
  if (!yaml.ok) {
    return yaml;
  }

  const parsed = profileFrontmatter.safeParse(yaml.value, {
    reportInput: true,
  });
  if (!parsed.success) {
    return err(zodErrors(source.file, parsed.error));
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
  for (const name of new Set(templateVariables(split.body))) {
    if (!allowed.has(name)) {
      errors.push({
        file: source.file,
        field: 'template',
        message: `unknown variable {{${name}}}`,
      });
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }

  return ok({
    id: frontmatter.id,
    label: frontmatter.label,
    verdict: frontmatter.verdict,
    rules: frontmatter.rules,
    skills: frontmatter.skills,
    artifacts: frontmatter.artifacts,
    body: split.body,
    path: source.path,
  });
};
