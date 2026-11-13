import type { Role, Workflow } from '../definitions/types';
import type { AttemptState, TaskState } from '../engine/state';
import { formatDuration } from '../format-duration';
import { plainPaint, type Paint } from '../paint';
import { describeStep, type StepDescription } from '../describe-step';

const retryText = (
  workflow: Workflow,
  state: TaskState,
  stepId: string,
  paint: Paint,
): string => {
  const max = workflow.steps.find((step) => step.id === stepId)?.onFail?.max;
  if (max === undefined) return '';
  const used = state.retriesUsed[stepId] ?? 0;
  const text = ` (retry ${used}/${max})`;
  return used > 0 ? paint.yellow(text) : text;
};

const finishedText = (
  workflow: Workflow,
  after: TaskState,
  attempt: AttemptState,
  now: number,
  paint: Paint,
): string => {
  const id = attempt.stepId;
  switch (attempt.outcome) {
    case 'done':
    case 'gate_pass':
    case 'verdict_pass':
      return paint.green(
        `✓ ${id} (${formatDuration(now - attempt.startedAt)})`,
      );
    case 'verdict_fail':
      return `${paint.red(`✗ ${id}: fail — ${attempt.feedbackPath ?? 'no feedback file'}`)}${retryText(workflow, after, id, paint)}`;
    case 'gate_fail':
      return `${paint.red(`✗ ${id}: fail — ${attempt.failures[0]?.command ?? 'gate'}`)}${retryText(workflow, after, id, paint)}`;
    default:
      return `${paint.red(`✗ ${id}: ${attempt.outcome ?? 'failed'}`)}${retryText(workflow, after, id, paint)}`;
  }
};

const isFinished = (attempt: AttemptState): boolean => {
  return (
    attempt.status === 'completed' ||
    attempt.status === 'passed' ||
    attempt.status === 'failed'
  );
};

/** `[workflow] text`: every console line carries its workflow. */
export const consoleLine = (workflow: string, text: string): string => {
  return `[${workflow}] ${text}`;
};

export const attemptStartedText = (
  stepId: string,
  description: StepDescription,
  n: number,
  paint: Paint = plainPaint,
): string => {
  const how =
    description.runner === undefined
      ? ''
      : ` (${description.runner}/${description.model ?? '?'})`;
  return paint.cyan(`▶ ${stepId} — ${description.label}${how}, attempt ${n}`);
};

export const commandStartText = (
  stepId: string,
  command: string,
  index: number,
  total: number,
  paint: Paint = plainPaint,
): string => {
  return paint.cyan(`▶ ${stepId}: ${command} (${index}/${total})`);
};

export const commandResultText = (
  stepId: string,
  command: string,
  index: number,
  total: number,
  result: { exitCode: number | null; timedOut: boolean },
  paint: Paint = plainPaint,
): string => {
  const verdict = result.timedOut
    ? 'timed out'
    : result.exitCode === 0
      ? 'exit 0'
      : `exit ${result.exitCode ?? '?'}`;
  const ok = !result.timedOut && result.exitCode === 0;
  const text = `${ok ? '✓' : '✗'} ${stepId}: ${command} (${index}/${total}) ${verdict}`;
  return ok ? paint.green(text) : paint.red(text);
};

export const heartbeatText = (
  stepId: string,
  elapsedMs: number,
  sinceOutputMs: number,
  paint: Paint = plainPaint,
): string => {
  return paint.dim(
    `heartbeat: ${stepId} working ${formatDuration(elapsedMs)}, last output ${formatDuration(sinceOutputMs)} ago`,
  );
};

export const hintText = (taskId: string, paint: Paint = plainPaint): string => {
  return paint.dim(`next: sf status · sf log ${taskId}`);
};

export const deliveryText = (
  prUrl: string,
  paint: Paint = plainPaint,
): string => {
  return paint.green(`✓ delivered — ${prUrl}`);
};

export const blockedText = (
  reason: string,
  detail: string,
  paint: Paint = plainPaint,
): string => {
  return paint.red(`■ blocked (${reason}): ${detail}`);
};

/**
 * One line per state change between two reductions of the same task, each
 * followed by the `sf` hint. A commands step prints no start line: its command
 * lines already say it began.
 */
export const transitionLines = (input: {
  before: TaskState;
  after: TaskState;
  workflow: Workflow;
  roles: ReadonlyMap<string, Role>;
  taskId: string;
  now: number;
  paint?: Paint;
}): string[] => {
  const { before, after, workflow, roles, taskId, now } = input;
  const paint = input.paint ?? plainPaint;
  const texts: string[] = [];
  if (before.setupOk === undefined && after.setupOk !== undefined) {
    texts.push(
      after.setupOk ? paint.green('✓ setup') : paint.red('✗ setup failed'),
    );
  }
  const known = new Map(
    before.attempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  for (const attempt of after.attempts) {
    const previous = known.get(attempt.attemptId);
    const description = describeStep(workflow, roles, attempt.stepId);
    if (previous === undefined && description?.runner !== undefined) {
      texts.push(
        attemptStartedText(attempt.stepId, description, attempt.n, paint),
      );
    }
    if (
      isFinished(attempt) &&
      (previous === undefined || !isFinished(previous))
    ) {
      texts.push(finishedText(workflow, after, attempt, now, paint));
    }
  }
  if (before.delivered === undefined && after.delivered !== undefined) {
    texts.push(deliveryText(after.delivered.prUrl, paint));
  }
  const block = after.block;
  if (
    block !== undefined &&
    (before.block?.reason !== block.reason ||
      before.block.detail !== block.detail)
  ) {
    texts.push(blockedText(block.reason, block.detail, paint));
  }
  return texts.flatMap((text) => [
    consoleLine(workflow.name, text),
    consoleLine(workflow.name, hintText(taskId, paint)),
  ]);
};
