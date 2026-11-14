import type { BlobRef } from '@repo/factory-core/ids';
import type {
  CycleContext,
  CycleInput,
} from '@repo/factory-core/order/context';
import type { OperatorProfile } from '@repo/factory-definitions/operator-profile';
import type { Template } from '@repo/factory-definitions/templates';
import { renderTemplate } from './render';

/** The Cycle, the profile and the bytes a prompt is built from. Every path in it is relative. */
export interface PromptInput {
  profile: OperatorProfile;
  templates: ReadonlyMap<string, Template>;
  todoId: string;
  cycleId: string;
  todoBody: string;
  context: CycleContext;
  /** Size in bytes of every input blob, so a large one is named by its path, not inlined. */
  blobSizes: ReadonlyMap<BlobRef, number>;
  /** Text of the blobs the prompt inlines: the verdict feedback and the inspection logs. */
  blobTexts: ReadonlyMap<BlobRef, string>;
  budget: { retry: number; max: number };
  declared: { rules: string[]; skills: string[] };
  operatorCommands: string[];
  logTailChars: number;
}

/** ANSI colour and cursor sequences, stripped from inspection logs before they reach a prompt. */
const ANSI = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`,
  'g',
);

/**
 * Every variable an Operator profile may use: the built-ins (`BUILT_IN_VARIABLES`, relative paths
 * only) and one `<key>Path` per artifact the Cycle hands over, as v1 named them.
 */
const variablesOf = (
  input: PromptInput,
  context: string,
): Record<string, string> => ({
  ...Object.fromEntries(
    input.context.outputs.map((output) => [`${output.key}Path`, output.path]),
  ),
  taskId: input.todoId,
  attemptId: input.cycleId,
  artifactDir: '.cell/outputs',
  evidenceDir: '.cell/evidence',
  todoBody: input.todoBody,
  context,
});

/**
 * Renders the prompt of one Cycle (CORE §7, PROTOCOL §4): the Operator profile body, then the inputs,
 * notes, feedback and prior answers of the Cycle, then the declared rules and skills and the CLI guide.
 * Every line comes from a template or from data; no path in it is absolute. Throws on a missing
 * template or variable, never renders an empty placeholder.
 */
export const buildPrompt = (input: PromptInput): string => {
  const template = (id: string): string => {
    const found = input.templates.get(id);
    if (found === undefined) throw new Error(`template "${id}" is not loaded`);
    return found.body;
  };
  const contextText = contextBlock(input, template).join('\n\n');
  const body = renderTemplate(
    input.profile.body,
    variablesOf(input, contextText),
  );
  const guide = renderTemplate(template('cli-guide'), {
    commands: input.operatorCommands.join('\n'),
  });
  const parts = [body.trimEnd()];
  if (!input.profile.body.includes('{{context}}') && contextText !== '') {
    parts.push(contextText);
  }
  parts.push(guide.trimEnd());
  return `${parts.join('\n\n')}\n`;
};

const contextBlock = (
  input: PromptInput,
  template: (id: string) => string,
): string[] => {
  const blocks: string[] = [];
  const contentOf = (ref: string, content: string): string =>
    renderTemplate(template('context-input'), { ref, content });
  const pathOf = (ref: string, path: string, size: number): string =>
    renderTemplate(template('context-input-path'), {
      ref,
      path,
      size: String(size),
    });

  for (const item of input.context.inputs) {
    blocks.push(inputBlock(item, input, contentOf, pathOf));
  }
  for (const note of input.context.notes) {
    blocks.push(
      renderTemplate(template('context-note'), {
        from: note.fromStation,
        text: note.text,
      }),
    );
  }
  const feedback = input.context.feedback;
  if (feedback?.kind === 'verdict') {
    blocks.push(
      renderTemplate(template('review-feedback'), {
        step: feedback.fromCycle,
        retry: String(input.budget.retry),
        max: String(input.budget.max),
        feedback: textOf(input, feedback.blob, '(feedback file is empty)'),
      }),
    );
  }
  if (feedback?.kind === 'inspection') {
    for (const result of feedback.results) {
      const log = textOf(input, result.logBlob, '');
      blocks.push(
        renderTemplate(template('gate-feedback'), {
          command: result.command,
          exitCode:
            result.exitCode === null ? 'timed out' : String(result.exitCode),
          tail: stripAnsi(log).slice(-input.logTailChars),
          logPath: '(inline above)',
          retry: String(input.budget.retry),
          max: String(input.budget.max),
        }),
      );
    }
  }
  for (const question of input.context.priorQuestions) {
    if (question.answer === undefined) continue;
    blocks.push(
      renderTemplate(template('answer'), {
        question: question.question,
        answer: question.answer,
      }),
    );
  }
  if (input.context.outputs.length > 0) {
    blocks.push(
      contentOf(
        'outputs',
        input.context.outputs
          .map((output) => `${output.key}: ${output.path}`)
          .join('\n'),
      ),
    );
  }
  if (input.declared.rules.length > 0) {
    blocks.push(contentOf('declared.rules', input.declared.rules.join('\n')));
  }
  if (input.declared.skills.length > 0) {
    blocks.push(contentOf('declared.skills', input.declared.skills.join('\n')));
  }
  return blocks;
};

const inputBlock = (
  item: CycleInput,
  input: PromptInput,
  contentOf: (ref: string, content: string) => string,
  pathOf: (ref: string, path: string, size: number) => string,
): string => {
  if (item.kind === 'order') {
    if (item.field === 'body') return contentOf('task.body', input.todoBody);
    return contentOf(`task.${item.field}`, item.value);
  }
  if (item.kind === 'inspection') {
    return contentOf(`${item.stationId}.inspection`, item.commands.join('\n'));
  }
  return pathOf(
    `${item.stationId}.${item.key}`,
    item.materialiseAs,
    input.blobSizes.get(item.blob) ?? 0,
  );
};

const textOf = (input: PromptInput, ref: BlobRef, fallback: string): string =>
  input.blobTexts.get(ref) ?? fallback;

const stripAnsi = (text: string): string => text.replace(ANSI, '');
