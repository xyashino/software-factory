import Handlebars from 'handlebars';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { sanitizeUntrustedText } from './sanitize';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const STAGES = ['sync', 'runtime'] as const;
const TYPES = ['string', 'number', 'boolean', 'list', 'map'] as const;

const fieldSchemas: Record<InputType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  list: z.array(z.unknown()),
  map: z.record(z.string(), z.unknown()),
};

const frontmatterSchema = z.looseObject({
  id: z.string().min(1, 'must not be empty'),
  stage: z.enum(STAGES, { error: 'must be sync or runtime' }),
  input: z.record(z.string(), z.enum(TYPES)).default({}),
});

type Stage = (typeof STAGES)[number];
type InputType = (typeof TYPES)[number];

interface Prompt {
  id: string;
  stage: Stage;
  input: Record<string, InputType>;
  config: Record<string, unknown>;
  body: string;
}

interface RenderOptions {
  inputs: Record<string, unknown>;
  partials?: Record<string, string>;
  helpers?: Record<string, Handlebars.HelperDelegate>;
}

const formatIssues = (
  issues: { path: PropertyKey[]; message: string }[],
): string =>
  issues
    .map((issue) => {
      const where = issue.path.map(String).join('.');
      return where ? `${where}: ${issue.message}` : issue.message;
    })
    .join('; ');

const inputSchema = (declared: Record<string, InputType>) =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(declared).map(([name, type]) => [
        name,
        fieldSchemas[type],
      ]),
    ),
  );

const sanitizeDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeUntrustedText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeDeep(item)]),
    );
  return value;
};

export const parsePrompt = (source: string): Prompt => {
  const match = FRONTMATTER.exec(source.replaceAll('\r\n', '\n'));
  if (match === null) {
    throw new Error('prompt needs a frontmatter block');
  }
  const doc = parseDocument(match[1] ?? '');
  const [syntax] = doc.errors;
  if (syntax !== undefined) {
    throw new Error(`frontmatter: ${syntax.message.split('\n')[0]}`);
  }
  const parsed = frontmatterSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new Error(`frontmatter: ${formatIssues(parsed.error.issues)}`);
  }
  const { id, stage, input, ...config } = parsed.data;
  return { id, stage, input, config, body: match[2] ?? '' };
};

export const renderPrompt = (
  prompt: Prompt,
  options: RenderOptions,
): string => {
  const inputs = inputSchema(prompt.input).safeParse(options.inputs);
  if (!inputs.success) {
    throw new Error(`${prompt.id}: ${formatIssues(inputs.error.issues)}`);
  }
  const env = Handlebars.create();
  for (const [name, source] of Object.entries(options.partials ?? {})) {
    env.registerPartial(name, source);
  }
  for (const [name, helper] of Object.entries(options.helpers ?? {})) {
    env.registerHelper(name, helper);
  }
  try {
    const template = env.compile(prompt.body, { noEscape: true, strict: true });
    return template(sanitizeDeep(inputs.data));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${prompt.id}: ${reason}`);
  }
};
