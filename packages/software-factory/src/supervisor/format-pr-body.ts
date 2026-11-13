import { splitFrontmatter } from '../definitions/frontmatter';
import type { Template } from '../definitions/types';
import { renderTemplate } from '../prompts/render';
import type { VerificationItem } from './ports';

const REPORT_MAX_CHARS = 4000;

export interface PrBodyInput {
  taskId: string;
  /** the todo file, frontmatter included */
  todoText: string;
  /** the `commit.txt` message */
  commitMessage: string;
  /** the `report.md` content, if any */
  report?: string;
  /** the decisions/ entry this change added, if any */
  adrPath?: string;
  /** the command that prints the task's event log */
  logCommand: string;
  /** the checklist, each line checked only when its result passed */
  verification: VerificationItem[];
}

/** Frontmatter `key: value` pairs of a todo, read as plain text. */
const frontmatterValue = (
  todoText: string,
  key: string,
): string | undefined => {
  const frontmatter = splitFrontmatter(todoText)?.frontmatter ?? '';
  const line = frontmatter
    .split('\n')
    .find((candidate) => candidate.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim() || undefined;
};

/** One checklist line per item: `[x]` only for a passed result, `[ ]` otherwise. */
const verificationLines = (items: VerificationItem[]): string[] => {
  if (items.length === 0) return ['_No verification steps in the workflow._'];
  return items.map((item) => `- [${item.passed ? 'x' : ' '}] ${item.label}`);
};

/** The report excerpt, cut to REPORT_MAX_CHARS, or undefined when there is no report. */
const reportExcerpt = (report: string | undefined): string | undefined => {
  const trimmed = report?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed.length > REPORT_MAX_CHARS
    ? `${trimmed.slice(0, REPORT_MAX_CHARS)}\n\n_(truncated)_`
    : trimmed;
};

/** The text of the named PR template. Throws when the registry lacks it. */
export const prTemplateBody = (
  templates: ReadonlyMap<string, Template>,
  id: string,
): string => {
  const found = templates.get(id);
  if (found === undefined) throw new Error(`PR template "${id}" is not loaded`);
  return found.body;
};

/** Ends rendered markdown with exactly one newline, whatever the template file ends with. */
export const finishMarkdown = (text: string): string => {
  return `${text.trimEnd()}\n`;
};

/** The todo's `## 🎯 Objective` section, or its whole body when there is none. */
export const extractObjective = (todoBody: string): string => {
  const match = /^##\s+.*Objective[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(
    todoBody,
  );
  const section = match?.[1]?.trim();
  return section !== undefined && section !== '' ? section : todoBody.trim();
};

/** The PR markdown, rendered from the `body` and `report` templates. */
export const formatPrBody = (
  input: PrBodyInput,
  templates: ReadonlyMap<string, Template>,
): string => {
  const body = splitFrontmatter(input.todoText)?.body ?? input.todoText;
  const type = frontmatterValue(input.todoText, 'type');
  const changes = input.commitMessage
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.trimEnd());
  const excerpt = reportExcerpt(input.report);

  const vars = {
    taskId: input.taskId,
    typeSuffix: type === undefined ? '' : ` (${type})`,
    objective: extractObjective(body),
    changes:
      changes.length > 0
        ? changes.join('\n')
        : '_No change list recorded in `commit.txt`._',
    adrSection:
      input.adrPath === undefined
        ? '_No decisions/ entry recorded for this change._'
        : `- Path: \`${input.adrPath}\``,
    verificationSection: verificationLines(input.verification).join('\n'),
    logCommand: input.logCommand,
    reportSection:
      excerpt === undefined
        ? ''
        : `\n${renderTemplate(prTemplateBody(templates, 'report'), { excerpt })}`,
  };
  return finishMarkdown(
    renderTemplate(prTemplateBody(templates, 'body'), vars),
  );
};
