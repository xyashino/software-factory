import { parseDocument } from 'yaml';
import type { DefinitionError } from './errors';
import { err, ok, type Result } from '@repo/factory-core/result';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface SplitMarkdown {
  frontmatter: string;
  body: string;
}

/** The first line of a yaml error, without the position it already reports. */
const summary = (message: string): string => {
  const first = message.split('\n')[0] ?? '';
  return first.replace(/ at line \d+, column \d+:$/, '');
};

/** Splits `---\nyaml\n---\nbody` into its two halves. Null when there is no frontmatter block. */
export const splitFrontmatter = (text: string): SplitMarkdown | null => {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    return null;
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
};

/** Parses YAML text, reporting syntax errors with line and column. */
export const parseYaml = (
  file: string,
  text: string,
): Result<unknown, DefinitionError[]> => {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return err(
      doc.errors.map((error) => {
        const position = error.linePos?.[0];
        const where = position
          ? `line ${position.line}, column ${position.col}`
          : 'unknown position';
        return {
          file,
          field: 'yaml',
          message: `syntax error at ${where}: ${summary(error.message)}`,
        };
      }),
    );
  }
  const value: unknown = doc.toJS();
  return ok(value);
};
