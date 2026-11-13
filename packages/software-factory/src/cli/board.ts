import type { Definitions, Workflow } from '../definitions/types';
import { formatDuration } from '../format-duration';
import type { Paint } from '../paint';
import { describeStep } from '../describe-step';
import { reduce } from '../engine/reduce';
import type { TaskState } from '../engine/state';
import type { StorePort, TaskRow } from '../ports/store.port';

export interface BoardRow {
  taskId: string;
  workflow: string;
  status: TaskState['status'];
  step: string | undefined;
  /** the step with its role label, as the console prints it: `plan (Planner)` */
  stepLabel: string | undefined;
  attempt: number | undefined;
  /** retries consumed across the whole task */
  retries: number;
  /** milliseconds since the current attempt started, or undefined when none runs */
  attemptMs: number | undefined;
  /** milliseconds since the task was created */
  taskMs: number;
  detail: string | undefined;
  /** the open agent question, if any */
  question: { to: 'operator' | 'human'; text: string } | undefined;
  /** tokens and cost summed over the task's attempts; undefined when no runner reported any */
  usage:
    { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
}

const usageOf = (state: TaskState | undefined): BoardRow['usage'] => {
  const reported = (state?.attempts ?? []).flatMap((attempt) =>
    attempt.usage === undefined ? [] : [attempt.usage],
  );
  if (reported.length === 0) return undefined;
  return {
    inputTokens: reported.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: reported.reduce((sum, item) => sum + item.outputTokens, 0),
    costUsd: reported.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
  };
};

/** Projects every task in the store into one board row. Pure given the store and clock. */
export const boardRows = (
  store: StorePort,
  definitions: Definitions,
  now: number,
  filter?: { taskId?: string },
): BoardRow[] => {
  return store
    .tasks()
    .filter((task) => filter?.taskId === undefined || task.id === filter.taskId)
    .map((task) => rowFor(task, store, definitions, now));
};

const rowFor = (
  task: TaskRow,
  store: StorePort,
  definitions: Definitions,
  now: number,
): BoardRow => {
  const workflow = definitions.workflows.get(task.workflow);
  const state =
    workflow === undefined
      ? undefined
      : reduce(workflow, store.events(task.id));
  const current = state?.current;
  const running =
    current !== undefined &&
    (current.status === 'starting' || current.status === 'running');
  const block = state?.block;
  return {
    taskId: task.id,
    workflow: task.workflow,
    // The log is the truth; the stored status is only a cache the supervisor writes.
    status: state?.status ?? task.status,
    step: current?.stepId,
    stepLabel: stepLabelOf(workflow, definitions, current?.stepId),
    attempt: current?.n,
    retries:
      state === undefined
        ? 0
        : Object.values(state.retriesUsed).reduce(
            (sum, count) => sum + count,
            0,
          ),
    attemptMs: running ? now - current.startedAt : undefined,
    taskMs: now - task.createdAt,
    detail:
      block === undefined ? undefined : `${block.reason}: ${block.detail}`,
    question:
      state?.openQuestion === undefined
        ? undefined
        : { to: state.openQuestion.to, text: state.openQuestion.text },
    usage: usageOf(state),
  };
};

const stepLabelOf = (
  workflow: Workflow | undefined,
  definitions: Definitions,
  stepId: string | undefined,
): string | undefined => {
  if (workflow === undefined || stepId === undefined) return undefined;
  const description = describeStep(workflow, definitions.roles, stepId);
  return description === undefined
    ? stepId
    : `${stepId} (${description.label})`;
};

/** The board as plain text lines; colour is applied through `paint`, which tests can disable. */
export const renderBoard = (
  rows: readonly BoardRow[],
  paint: Paint,
): string => {
  if (rows.length === 0) return 'no tasks yet';
  const header = [
    'TASK',
    'WORKFLOW',
    'STATUS',
    'STEP',
    'ATTEMPT',
    'RETRIES',
    'ATTEMPT TIME',
    'TASK TIME',
    'TOKENS IN/OUT',
    'COST',
  ];
  const body = rows.map((row) => [
    row.taskId,
    row.workflow,
    row.status,
    row.stepLabel ?? row.step ?? '-',
    row.attempt === undefined ? '-' : `#${row.attempt}`,
    String(row.retries),
    formatDuration(row.attemptMs),
    formatDuration(row.taskMs),
    row.usage === undefined
      ? '-'
      : `${row.usage.inputTokens}/${row.usage.outputTokens}`,
    row.usage === undefined ? '-' : `$${row.usage.costUsd.toFixed(4)}`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(
      title.length,
      ...body.map((cells) => (cells[column] ?? '').length),
    ),
  );
  const RETRIES = header.indexOf('RETRIES');
  const line = (cells: readonly string[], retried = false): string =>
    cells
      .map((cell, column) => {
        const padded = cell.padEnd(widths[column] ?? 0);
        return retried && column === RETRIES ? paint.yellow(padded) : padded;
      })
      .join('  ')
      .trimEnd();

  const lines = [paint.bold(line(header))];
  for (const [index, cells] of body.entries()) {
    const row = rows[index];
    const colour =
      row?.status === 'delivered'
        ? paint.green
        : row?.status === 'blocked' || row?.status === 'parked'
          ? paint.red
          : row?.status === 'waiting'
            ? paint.yellow
            : row?.status === 'running'
              ? paint.cyan
              : (text: string) => text;
    lines.push(colour(line(cells, (row?.retries ?? 0) > 0)));
    if (row?.detail !== undefined) lines.push(`  ${paint.red(row.detail)}`);
    if (row?.question !== undefined) {
      lines.push(
        `  ${paint.yellow(`question to ${row.question.to}: ${row.question.text}`)}`,
        `  ${paint.yellow(`sf answer ${row.taskId} "<your answer>"`)}`,
      );
    }
  }
  return lines.join('\n');
};
