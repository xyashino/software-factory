import type { z } from 'zod';

/** One load-time problem. `file` is relative to the package root. */
export interface DefinitionError {
  file: string;
  field: string;
  message: string;
}

const issueMessage = (issue: z.core.$ZodIssue): string => {
  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return 'is required';
  }
  return issue.message;
};

/** Renders a zod issue path as a dotted YAML-like path: `steps[2].onFail.retry`. */
export const formatPath = (path: readonly PropertyKey[]): string => {
  if (path.length === 0) {
    return '(root)';
  }
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
};

/** Converts a failed zod parse into one error per problem. */
export const zodErrors = (
  file: string,
  error: z.ZodError,
): DefinitionError[] => {
  return error.issues.flatMap((issue): DefinitionError[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        file,
        field: formatPath([...issue.path, key]),
        message: 'unknown key',
      }));
    }
    return [
      { file, field: formatPath(issue.path), message: issueMessage(issue) },
    ];
  });
};
