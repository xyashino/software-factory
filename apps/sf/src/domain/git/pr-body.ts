const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const OBJECTIVE_SECTION =
  /^##[ \t]+[^\n]*Objective[^\n]*\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const NO_ADR = '_No `decisions/` entry recorded for this change._';
const NO_CHECKS = '_No automated checks configured._';

export interface AdrEntry {
  path: string;
  content: string;
}

const unquote = (value: string): string =>
  value.trim().replace(/^(['"])(.*)\1$/, '$2');

const frontmatterOf = (
  content: string,
): { fields: Record<string, string>; body: string } => {
  const match = FRONTMATTER.exec(content);
  if (match === null) {
    return { fields: {}, body: content.trim() };
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      fields[line.slice(0, separator).trim()] = unquote(
        line.slice(separator + 1),
      );
    }
  }
  return { fields, body: content.slice(match[0].length).trim() };
};

const formatAdrEntry = (entry: AdrEntry): string => {
  const { fields, body } = frontmatterOf(entry.content);
  return [
    `**[\`${entry.path}\`](${entry.path})**`,
    fields.summary,
    fields.why === undefined || fields.why === ''
      ? undefined
      : `> **Why:** ${fields.why}`,
    body,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join('\n\n');
};

export const prTitleOf = (commitText: string): string =>
  commitText.trim().split('\n')[0] ?? '';

export const prChangesOf = (commitText: string): string =>
  commitText.trim().split('\n').slice(1).join('\n').trim();

export const renderPrBody = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  template.replace(PLACEHOLDER, (_, key: string) => values[key] ?? '');

export const extractObjective = (
  description: string,
  fallbackTitle: string,
): string => {
  const section = OBJECTIVE_SECTION.exec(description)?.[1]?.trim();
  if (section !== undefined && section !== '') {
    return section;
  }
  const paragraph = description
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !block.startsWith('#'));
  return paragraph ?? fallbackTitle;
};

export const formatAdrEntries = (entries: readonly AdrEntry[]): string =>
  entries.length === 0
    ? NO_ADR
    : entries.map(formatAdrEntry).join('\n\n---\n\n');

export const formatChecks = (commands: readonly string[]): string =>
  commands.length === 0
    ? NO_CHECKS
    : commands.map((command) => `- [x] \`${command}\``).join('\n');
