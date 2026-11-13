const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export class MissingVariableError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`missing template variable {{${variable}}}`);
    this.name = 'MissingVariableError';
    this.variable = variable;
  }
}

/**
 * Replaces every `{{key}}` with its value. Throws MissingVariableError for a
 * placeholder with no value; it never renders an empty string instead.
 */
export const renderTemplate = (
  template: string,
  vars: Record<string, string>,
): string => {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined;
    if (value === undefined) {
      throw new MissingVariableError(name);
    }
    return value;
  });
};

/** The distinct placeholder names in a template, in order of first appearance. */
export const templateVariables = (template: string): string[] => {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1] !== undefined) {
      names.add(match[1]);
    }
  }
  return [...names];
};
