import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import {
  type WorkOrderDetail,
  showWorkOrder,
} from '../../application/procedures/work-orders/show.procedure';
import {
  TRANSITION_ACTIONS,
  type TransitionResult,
  transitionWorkOrder,
} from '../../application/procedures/work-orders/transition.procedure';
import {
  createTestWorkOrder,
  type TestOrderResult,
} from '../../application/procedures/work-orders/test.procedure';
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

const printTest = (result: TestOrderResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  printLine(
    `${result.order.orderId} ${result.order.state} line=${result.order.lineName} priority=${result.order.priority}`,
  );
};

const runShow = async (orderId: string, json: boolean): Promise<number> => {
  const result = await run(showWorkOrder, { orderId }, 'supervisor');
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
    'supervisor',
  );
  if (result.kind === 'ok') {
    printTransition(result.value, options.json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runTest = async (options: {
  line?: string;
  slug?: string;
  json: boolean;
}): Promise<number> => {
  const result = await run(
    createTestWorkOrder,
    {
      configPath: resolve(process.cwd(), REPO_CONFIG_PATH),
      lineName: options.line,
      slug: options.slug,
    },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printTest(result.value, options.json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const showCommand = defineCommand({
  meta: {
    name: 'show',
    description:
      'Show one work order with steps, jobs and incidents. Needs scope supervisor:read',
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

const testCommand = defineCommand({
  meta: {
    name: 'test',
    description:
      'Queue a smoke-test chore order for this repo without a todos file. Needs scope supervisor:write',
  },
  args: {
    line: {
      type: 'string',
      description: 'Line to queue on (default fast)',
    },
    slug: {
      type: 'string',
      description: 'Order slug (default smoke-test-<epoch seconds>)',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runTest({
      line: args.line,
      slug: args.slug,
      json: args.json,
    });
  },
});

export const orderCommand = defineCommand({
  meta: {
    name: 'order',
    description:
      'Show and change one work order. Needs scope supervisor:write for changes',
  },
  subCommands: {
    show: showCommand,
    test: testCommand,
    resume: transitionCommand('resume', 'Resume a blocked work order'),
    reopen: transitionCommand('reopen', 'Reopen a completed work order'),
    cancel: transitionCommand('cancel', 'Cancel a work order (needs --yes)'),
  },
});
