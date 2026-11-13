import { readFileSync, statSync } from 'node:fs';
import type { AttemptContext, FeedbackContext } from '../engine/context';
import type { Role, Template } from '../definitions/types';
import { renderTemplate } from './render';

export const INLINE_LIMIT_CHARS = 20_000;

export interface PromptInput {
  role: Role;
  templates: ReadonlyMap<string, Template>;
  taskId: string;
  attemptId: string;
  todoBody: string;
  context: AttemptContext;
  artifacts: Record<string, string>;
  evidenceDir: string;
  budget: { retry: number; max: number } | undefined;
  cliCommands: string[];
  extraContext?: string[];
}

/**
 * Renders the attempt prompt: the role body with its variables, then the
 * resolved inputs and feedback, then the generated CLI guide.
 * Throws on a missing template variable; never renders an empty placeholder.
 */
export const buildPrompt = (input: PromptInput): string => {
  const template = (id: string): string => {
    const found = input.templates.get(id);
    if (found === undefined) throw new Error(`template "${id}" is not loaded`);
    return found.body;
  };

  const contextParts = [
    ...input.context.inputs.flatMap((ref) => renderInput(ref, template)),
    ...input.context.notes.map((note) =>
      renderTemplate(template('context-note'), {
        from: note.fromStep,
        text: note.text,
      }),
    ),
    ...renderFeedback(input, template),
    ...(input.extraContext ?? []),
  ];
  const context = contextParts.join('\n\n');

  const artifactVars = Object.fromEntries(
    Object.entries(input.artifacts).map(([key, path]) => [`${key}Path`, path]),
  );
  const vars: Record<string, string> = {
    ...artifactVars,
    taskId: input.taskId,
    attemptId: input.attemptId,
    todoBody: input.todoBody,
    context,
    evidenceDir: input.evidenceDir,
  };

  const body = renderTemplate(input.role.body, vars);
  const guide = renderTemplate(template('cli-guide'), {
    commands: input.cliCommands.join('\n'),
  });
  const declarations = renderDeclarations(input.role);
  const parts = [body.trimEnd(), declarations, guide.trimEnd()].filter(
    (part) => part !== '',
  );
  return `${parts.join('\n\n')}\n`;
};

/** The role's declared rules and skills as path lists; empty when it declares none. */
const renderDeclarations = (role: Role): string => {
  const blocks: string[] = [];
  if (role.rules.length > 0) {
    const lines = role.rules.map((id) => `- ${id}: .nitpick/config.ts`);
    blocks.push(
      `## Rules\n\nRead and follow these rules (the rule or group with that id in the \`rules\` tree of the file):\n${lines.join('\n')}`,
    );
  }
  if (role.skills.length > 0) {
    const lines = role.skills.map(
      (id) => `- ${id}: .nitpick/skills/${id}/SKILL.md`,
    );
    blocks.push(
      `## Skills\n\nRead these skills and follow them when they apply:\n${lines.join('\n')}`,
    );
  }
  return blocks.join('\n\n');
};

type TemplateLookup = (id: string) => string;

const renderInput = (
  ref: AttemptContext['inputs'][number],
  template: TemplateLookup,
): string[] => {
  if (ref.kind === 'gate') {
    if (ref.attemptId === undefined) return [];
    return [
      renderTemplate(template('gate-pass'), {
        step: ref.stepId,
        attemptId: ref.attemptId,
        commands: ref.commands.map((command) => `- \`${command}\``).join('\n'),
      }),
    ];
  }
  if (ref.kind === 'task') {
    if (ref.value === undefined) return [];
    return [
      renderTemplate(template('context-input'), {
        ref: `task.${ref.field}`,
        content: ref.value,
      }),
    ];
  }
  if (ref.path === undefined) return [];
  const label = `${ref.stepId}.${ref.artifactKey}`;
  const size = fileSize(ref.path);
  if (size > INLINE_LIMIT_CHARS) {
    return [
      renderTemplate(template('context-input-path'), {
        ref: label,
        path: ref.path,
        size: String(size),
      }),
    ];
  }
  return [
    renderTemplate(template('context-input'), {
      ref: label,
      content: readOr(ref.path, ''),
    }),
  ];
};

const renderFeedback = (
  input: PromptInput,
  template: TemplateLookup,
): string[] => {
  const feedback = input.context.feedback;
  if (feedback === undefined) return [];
  const budget = input.budget ?? { retry: 0, max: 0 };
  return [feedbackText(feedback, budget, template)];
};

const feedbackText = (
  feedback: FeedbackContext,
  budget: { retry: number; max: number },
  template: TemplateLookup,
): string => {
  if (feedback.kind === 'verdict') {
    const body =
      feedback.feedbackPath === undefined
        ? '(the judge wrote no feedback file)'
        : readOr(feedback.feedbackPath, '(feedback file is empty)');
    return renderTemplate(template('review-feedback'), {
      step: feedback.fromAttempt,
      retry: String(budget.retry),
      max: String(budget.max),
      feedback: body,
    });
  }
  return feedback.failures
    .map((failure) =>
      renderTemplate(template('gate-feedback'), {
        command: failure.command,
        exitCode:
          failure.exitCode === null ? 'timed out' : String(failure.exitCode),
        tail: failure.tail,
        logPath: failure.logPath,
        retry: String(budget.retry),
        max: String(budget.max),
      }),
    )
    .join('\n\n');
};

const readOr = (path: string, fallback: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};
