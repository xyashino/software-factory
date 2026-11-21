import { defineCommand } from 'citty';
import { ArgumentError, Unreachable } from '../../application/core/errors';
import { sendBlock } from '../../application/procedures/operator/block.procedure';
import { sendContext } from '../../application/procedures/operator/context.procedure';
import { sendDone } from '../../application/procedures/operator/done.procedure';
import {
  type IncidentFields,
  sendIncident,
} from '../../application/procedures/operator/incident.procedure';
import { sendRead } from '../../application/procedures/operator/read.procedure';
import {
  sendVerdictFail,
  sendVerdictPass,
} from '../../application/procedures/operator/verdict.procedure';
import type {
  OperatorClientPort,
  OperatorReply,
} from '../../application/ports/operator-client.port';
import { EXIT } from '../../domain/exit-codes';
import { readOperatorFile } from '../fs/operator-files';
import { createOperatorClient } from '../operator-client/client';
import { errorLineFor, exitCodeFor } from '../operator-client/exit-map';
import { printError, printLine } from './output';

const URL_ENV = 'FACTORY_OPERATOR_URL';
const TOKEN_ENV = 'FACTORY_CYCLE_TOKEN';
const INCIDENT_ACTIONS: readonly IncidentAction[] = [
  'retry_step',
  'restart_from_step',
  'restart_from_scratch',
  'escalate',
  'cancel',
];

type IncidentAction = IncidentFields['action'];
type Show = 'ok' | 'body';
type Prepare = () => (client: OperatorClientPort) => Promise<OperatorReply>;

interface IncidentArgs {
  action?: string;
  step?: string;
  diagnosis?: string;
  outcome?: string;
  report?: string;
}

const requiredText = (value: string | undefined, flag: string): string => {
  if (value === undefined || value.trim() === '') {
    throw new ArgumentError(`${flag} is required`);
  }
  return value;
};

const isIncidentAction = (value: string): value is IncidentAction =>
  INCIDENT_ACTIONS.some((action) => action === value);

const envValue = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new ArgumentError(`${name} is not set: run this inside a Cycle`);
  }
  return value;
};

const clientFromEnv = (): OperatorClientPort =>
  createOperatorClient({
    url: envValue(URL_ENV),
    token: envValue(TOKEN_ENV),
  });

const incidentFields = (args: IncidentArgs): Omit<IncidentFields, 'verb'> => {
  const action = requiredText(args.action, '--action');
  if (!isIncidentAction(action)) {
    throw new ArgumentError(
      `--action takes ${INCIDENT_ACTIONS.join(', ')}, not "${action}"`,
    );
  }
  const step = args.step;
  if (action === 'restart_from_step' && step === undefined) {
    throw new ArgumentError('--step is required for restart_from_step');
  }
  return {
    action,
    step,
    diagnosis: requiredText(args.diagnosis, '--diagnosis'),
    outcome: requiredText(args.outcome, '--outcome'),
    report: readOperatorFile(requiredText(args.report, '--report'), '--report'),
  };
};

const report = (reply: OperatorReply, show: Show): number => {
  const exitCode = exitCodeFor(reply.status);
  if (exitCode !== EXIT.ok) {
    printError(errorLineFor(reply) ?? `the Cell replied HTTP ${reply.status}`);
    return exitCode;
  }
  printLine(show === 'body' ? JSON.stringify(reply.body) : 'ok: true');
  return EXIT.ok;
};

const failure = (error: unknown): number => {
  if (error instanceof ArgumentError) {
    printError(error.message);
    return EXIT.argument;
  }
  if (error instanceof Unreachable) {
    printError(error.message);
    return EXIT.unreachable;
  }
  printError('unexpected error');
  return EXIT.unreachable;
};

// File checks run before the environment is read, so a bad flag never needs
// the Cell's variables and nothing is sent when a check fails.
const runVerb = async (prepare: Prepare, show: Show): Promise<number> => {
  try {
    const send = prepare();
    const client = clientFromEnv();
    return report(await send(client), show);
  } catch (error) {
    return failure(error);
  }
};

const doneCommand = defineCommand({
  meta: { name: 'done', description: 'Station finished' },
  run: async () => {
    process.exitCode = await runVerb(() => sendDone, 'ok');
  },
});

const verdictPassCommand = defineCommand({
  meta: { name: 'pass', description: 'Review station passes' },
  run: async () => {
    process.exitCode = await runVerb(() => sendVerdictPass, 'ok');
  },
});

const verdictFailCommand = defineCommand({
  meta: { name: 'fail', description: 'Review station fails' },
  args: {
    feedback: {
      type: 'string',
      description: 'Feedback file, - reads stdin',
    },
  },
  run: async ({ args }) => {
    process.exitCode = await runVerb(() => {
      const feedback = readOperatorFile(
        requiredText(args.feedback, '--feedback'),
        '--feedback',
      );
      return (client) => sendVerdictFail(client, feedback);
    }, 'ok');
  },
});

const verdictCommand = defineCommand({
  meta: { name: 'verdict', description: 'Review verdict: pass or fail' },
  subCommands: { pass: verdictPassCommand, fail: verdictFailCommand },
});

const blockCommand = defineCommand({
  meta: { name: 'block', description: 'Stop and hand over to the Supervisor' },
  args: {
    reason: { type: 'string', description: 'Why the job stops' },
    handover: { type: 'string', description: 'Handover file, - reads stdin' },
  },
  run: async ({ args }) => {
    process.exitCode = await runVerb(() => {
      const reason = requiredText(args.reason, '--reason');
      const handover = readOperatorFile(
        requiredText(args.handover, '--handover'),
        '--handover',
      );
      return (client) => sendBlock(client, reason, handover);
    }, 'ok');
  },
});

const contextCommand = defineCommand({
  meta: { name: 'context', description: "Print the job's inputs and outputs" },
  run: async () => {
    process.exitCode = await runVerb(() => sendContext, 'body');
  },
});

const readCommand = defineCommand({
  meta: {
    name: 'read',
    description: 'Print the incident, step states and logs',
  },
  run: async () => {
    process.exitCode = await runVerb(() => sendRead, 'body');
  },
});

const incidentCommand = defineCommand({
  meta: { name: 'incident', description: 'Record and apply a resolution' },
  args: {
    action: {
      type: 'string',
      description: INCIDENT_ACTIONS.join('|'),
    },
    step: { type: 'string', description: 'Step id, for restart_from_step' },
    diagnosis: { type: 'string', description: 'What happened' },
    outcome: { type: 'string', description: 'What was tried' },
    report: { type: 'string', description: 'Report file, - reads stdin' },
  },
  run: async ({ args }) => {
    process.exitCode = await runVerb(() => {
      const fields = incidentFields(args);
      return (client) => sendIncident(client, fields);
    }, 'ok');
  },
});

export const operatorCommand = defineCommand({
  meta: {
    name: 'operator',
    description: 'Verbs for an agent running inside a Cell job',
  },
  subCommands: {
    done: doneCommand,
    verdict: verdictCommand,
    block: blockCommand,
    context: contextCommand,
    read: readCommand,
    incident: incidentCommand,
  },
});
