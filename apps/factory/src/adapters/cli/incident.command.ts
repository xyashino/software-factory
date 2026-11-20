import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import {
  type IncidentListResult,
  listIncidents,
} from '../../application/procedures/incidents/list.procedure';
import {
  RESOLVE_ACTIONS,
  type ResolveResult,
  resolveIncident,
} from '../../application/procedures/incidents/resolve.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, printTable, reportFailure } from './output';
import { requiredPositional } from './validate';

const HEADERS = ['id', 'reason', 'order', 'status', 'triage owner'];

interface ListFilters {
  project?: string;
  order?: string;
  reason?: string;
  status?: string;
}

const printList = (result: IncidentListResult, json: boolean): void => {
  if (json) {
    printJson(result.rows);
    return;
  }
  printTable(
    HEADERS,
    result.rows.map((row) => [
      row.incidentId,
      row.reason,
      row.orderId,
      row.status,
      row.triageOwner,
    ]),
  );
};

const printResolve = (result: ResolveResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  printLine(
    `incident ${result.incident.incidentId} ${result.incident.status}, order ${result.workOrder.orderId} ${result.workOrder.state}`,
  );
};

const runList = async (
  filters: ListFilters,
  json: boolean,
): Promise<number> => {
  const result = await run(
    listIncidents,
    { configPath: resolve(process.cwd(), REPO_CONFIG_PATH), ...filters },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printList(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

const runResolve = async (
  input: {
    incidentId: string;
    action?: string;
    step?: string;
    report?: string;
  },
  json: boolean,
): Promise<number> => {
  const result = await run(resolveIncident, input, 'supervisor');
  if (result.kind === 'ok') {
    printResolve(result.value, json);
    return EXIT.ok;
  }
  return reportFailure(result);
};

// The parent declares the filter flags too: citty reads a bare word after an
// undeclared flag as a subcommand name, so `incident --status x` would fail.
const LIST_ARGS = {
  project: { type: 'string', description: 'Project id (default: repo config)' },
  order: { type: 'string', description: 'Only this work order id' },
  reason: { type: 'string', description: 'Only this incident reason' },
  status: { type: 'string', description: 'Only this incident status' },
  json: { type: 'boolean', default: false },
} as const;

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List incidents. Needs scope supervisor:read',
  },
  args: LIST_ARGS,
  run: async ({ args }) => {
    process.exitCode = await runList(
      {
        project: args.project,
        order: args.order,
        reason: args.reason,
        status: args.status,
      },
      args.json,
    );
  },
});

const resolveCommand = defineCommand({
  meta: {
    name: 'resolve',
    description: `Resolve an incident: ${RESOLVE_ACTIONS.join('|')}. Needs scope supervisor:write`,
  },
  args: {
    id: { type: 'positional', required: true, description: 'Incident id' },
    action: {
      type: 'string',
      description: `One of ${RESOLVE_ACTIONS.join(', ')}`,
    },
    step: {
      type: 'string',
      description: 'Step index, required for retry_step and restart_from_step',
    },
    report: {
      type: 'string',
      description: 'Report file (not accepted by the server yet)',
    },
    json: { type: 'boolean', default: false },
  },
  run: async ({ args }) => {
    process.exitCode = await runResolve(
      {
        incidentId: requiredPositional(args.id, 'incident id'),
        action: args.action,
        step: args.step,
        report: args.report,
      },
      args.json,
    );
  },
});

export const incidentCommand = defineCommand({
  meta: {
    name: 'incident',
    description: 'List and resolve incidents (Supervisor escalation path)',
  },
  args: LIST_ARGS,
  default: 'list',
  subCommands: {
    list: listCommand,
    resolve: resolveCommand,
  },
});
