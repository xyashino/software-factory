import { PR_ADR_TOKEN } from '@repo/factory-core/contracts/job';
import type { BlobRef } from '@repo/factory-core/ids';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import type { ArtifactRef } from '@repo/factory-definitions/line-schema';
import type { Template } from '@repo/factory-definitions/templates';
import { renderTemplate } from './prompts/render';

/**
 * The PR of a delivery, built the way v1 builds it (`packages/software-factory`, `format-pr-body.ts`):
 * the title and commit come from the builder's own `commit` artifact, and the body is the `body` PR
 * template with the todo's objective, the change list, the ADR, the checklist and the report.
 */

const REPORT_MAX_CHARS = 4000;
/** The longest commit message a deliver job carries (`deliverSchema`). */
const COMMIT_MAX_CHARS = 4096;

/** Subject of a monorepo commit: `type(scope): message`, scope required (v1 `delivery-commit.ts`). */
const SUBJECT =
  /^(feat|fix|refactor|docs|test|chore|build|ci|perf|style|revert)\([^()\s]+\)!?: \S.*$/;

/** A commit message trimmed line by line, or undefined when it is empty or its subject is not `type(scope): …`. */
export const usableCommitMessage = (
  text: string | undefined,
): string | undefined => {
  const message = (text ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  if (message === '' || message.length > COMMIT_MAX_CHARS) return undefined;
  const subject = commitTitle(message);
  return SUBJECT.test(subject) && subject.length <= 256 ? message : undefined;
};

/** The subject line: the PR title and the commit title. */
export const commitTitle = (message: string): string =>
  message.split('\n')[0]?.trim() ?? '';

/** The blob of an artifact from the latest passed Cycle of its Station, if one handed it over. */
export const artifactBlob = (
  state: Pick<WorkOrderState, 'cycles'>,
  ref: ArtifactRef,
): BlobRef | undefined => {
  for (const cycle of [...state.cycles].reverse()) {
    if (cycle.stationId !== ref.stationId || cycle.status !== 'passed')
      continue;
    const blob = cycle.artifacts[ref.artifactKey];
    if (blob !== undefined) return blob;
  }
  return undefined;
};

/** The todo's `## Objective` section (any emoji before the word), or its whole body when there is none. */
export const extractObjective = (todoBody: string): string => {
  const match = /^##\s+.*Objective[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(
    todoBody,
  );
  const section = match?.[1]?.trim();
  return section !== undefined && section !== '' ? section : todoBody.trim();
};

/** One entry of a delivery's verification list, as the job carries it: an Inspection or an Operator station. */
export type VerificationEntry =
  | { kind: 'inspection'; stationId: string; commands: string[] }
  | { kind: 'operator'; stationId: string; profile: string };

/**
 * The checklist: one line per Inspection command and per Operator Station. Delivery runs only after
 * every Station passed, so each line is checked.
 */
export const verificationLinesOf = (
  entries: readonly VerificationEntry[],
): string[] => {
  const lines = entries.flatMap((entry): string[] => {
    if (entry.kind === 'inspection') {
      return entry.commands.map((command) => `- [x] \`${command}\``);
    }
    return [`- [x] Operator station \`${entry.stationId}\` (${entry.profile})`];
  });
  return lines.length > 0 ? lines : ['_No verification steps in the Line._'];
};

const reportExcerpt = (report: string | undefined): string | undefined => {
  const trimmed = report?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed.length > REPORT_MAX_CHARS
    ? `${trimmed.slice(0, REPORT_MAX_CHARS)}\n\n_(truncated)_`
    : trimmed;
};

const templateBody = (
  templates: ReadonlyMap<string, Template>,
  id: string,
): string => {
  const found = templates.get(id);
  if (found === undefined) throw new Error(`PR template "${id}" is not loaded`);
  return found.body;
};

export interface PrBodyInput {
  taskId: string;
  type: string;
  /** The todo body, without frontmatter. */
  todoBody: string;
  commitMessage: string;
  report?: string;
  logCommand: string;
  verification: string[];
}

/** The PR markdown from the `body` and `report` templates. `{{adrSection}}` stays for the Cell to fill. */
export const formatPrBody = (
  input: PrBodyInput,
  templates: ReadonlyMap<string, Template>,
): string => {
  const changes = input.commitMessage
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.trimEnd());
  const excerpt = reportExcerpt(input.report);
  const body = renderTemplate(templateBody(templates, 'body'), {
    taskId: input.taskId,
    typeSuffix: ` (${input.type})`,
    objective: extractObjective(input.todoBody),
    changes:
      changes.length > 0
        ? changes.join('\n')
        : '_No change list in the commit message._',
    adrSection: PR_ADR_TOKEN,
    verificationSection: input.verification.join('\n'),
    logCommand: input.logCommand,
    reportSection:
      excerpt === undefined
        ? ''
        : `\n${renderTemplate(templateBody(templates, 'report'), { excerpt })}`,
  });
  return `${body.trimEnd()}\n`;
};
