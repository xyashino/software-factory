import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import {
  type WorkOrderDetail,
  showWorkOrder,
} from '../../application/procedures/work-orders/show.procedure';
import {
  TRANSITION_ACTIONS,
  type TransitionResult,
  transitionWorkOrder,
} from '../../application/procedures/work-orders/transition.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, printTable, reportFailure } from './output';
import { requiredPositional } from './validate';

type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

const STEP_HEADERS = ['step', 'station', 'kind', 'state'];
const JOB_HEADERS = ['job', 'kind', 'status', 'cell'];
const INCIDENT_HEADERS = ['incident', 'reason', 'status'];

const printShow = (detail: WorkOrderDetail, json: boolean): void => {
  if (json) {
    printJson(detail);
    return;
  }
  printLine(
    `${detail.order.orderId} ${detail.order.state} line=${detail.order.lineName} priority=${detail.order.priority}`,
  );
  printTable(
    STEP_HEADERS,
    detail.steps.map((step) => [
      String(step.stepIndex),
      step.stationId,
      step.kind,
      step.state,
    ]),
  );
  printTable(
    JOB_HEADERS,
    detail.jobs.map((job) => [
      job.jobId,
      job.kind,
      job.status,
      job.cellId ?? '-',
    ]),
  );
  printTable(
    INCIDENT_HEADERS,
    detail.incidents.map((incident) => [
      incident.incidentId,
      incident.reason,
      incident.status,
    ]),
  );
};

const printTransition = (result: TransitionResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  printLine(`${result.order.orderId} ${result.order.state}`);
};

const runShow = async (orderId: string, json: boolean): Promise<number> => {
  const result = await run(showWorkOrder, { orderId }, 'operator');
  if (result.kind === 'ok') {
    printShow(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runTransition = async (
  action: TransitionAction,
  orderId: string,
  options: { yes: boolean; json: boolean },
): Promise<number> => {
  const result = await run(
    transitionWorkOrder,
    { orderId, action, yes: options.yes },
    'operator',
  );
  if (result.kind === 'ok') {
    printTransition(result.value, options.json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const showCommand = defineCommand({
  meta: {
    name: 'show',
    description:
      'Show one work order with steps, jobs and incidents. Needs scope operator:read',
  },
  args: {
    id: { type: 'positional', required: true, description: 'Work order id' },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runShow(
      requiredPositional(args.id, 'work order id'),
      args.json,
    );
  },
});

const transitionCommand = (action: TransitionAction, description: string) =>
  defineCommand({
    meta: { name: action, description },
    args: {
      id: { type: 'positional', required: true, description: 'Work order id' },
      json: { type: 'boolean', default: false },
      yes: {
        type: 'boolean',
        default: false,
        description: 'Confirm the change (required for cancel)',
      },
    },
    run: async ({ args }) => {
      process.exitCode = await runTransition(
        action,
        requiredPositional(args.id, 'work order id'),
        { yes: args.yes, json: args.json },
      );
    },
  });

export const orderCommand = defineCommand({
  meta: {
    name: 'order',
    description:
      'Show and change one work order. Needs scope operator:write for changes',
  },
  subCommands: {
    show: showCommand,
    resume: transitionCommand('resume', 'Resume a blocked work order'),
    reopen: transitionCommand('reopen', 'Reopen a completed work order'),
    cancel: transitionCommand('cancel', 'Cancel a work order (needs --yes)'),
  },
});
