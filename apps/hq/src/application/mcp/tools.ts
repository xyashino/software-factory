import { z } from 'zod';
import type { Procedure } from '../core/procedure';
import type { TokenScope } from '../ports/auth.port';
import { getWorkOrderProcedure } from '../procedures/work-orders/get-work-order.procedure';
import { importQueueProcedure } from '../procedures/queue/import-queue.procedure';
import { listFactoriesProcedure } from '../procedures/factories/list-factories.procedure';
import { listIncidentsProcedure } from '../procedures/incidents/list-incidents.procedure';
import { listOrderPlansProcedure } from '../procedures/order-plans/list-order-plans.procedure';
import { listProjectsProcedure } from '../procedures/projects/list-projects.procedure';
import { listWorkOrdersProcedure } from '../procedures/work-orders/list-work-orders.procedure';
import { queueActionsProcedure } from '../procedures/queue/queue-actions.procedure';
import { resolveIncidentProcedure } from '../procedures/incidents/resolve-incident.procedure';
import { transitionOrderPlanProcedure } from '../procedures/order-plans/transition-order-plan.procedure';
import { transitionWorkOrderProcedure } from '../procedures/work-orders/transition-work-order.procedure';

export const mcpTools: readonly McpTool[] = [
  {
    name: 'list_projects',
    description: 'List HQ projects.',
    scope: 'supervisor:read',
    procedure: listProjectsProcedure,
  },
  {
    name: 'list_factories',
    description: 'List factories with online state.',
    scope: 'supervisor:read',
    procedure: listFactoriesProcedure,
  },
  {
    name: 'list_work_orders',
    description:
      'List work orders of a project, filterable by plan, line, state.',
    scope: 'supervisor:read',
    procedure: listWorkOrdersProcedure,
  },
  {
    name: 'get_work_order',
    description: 'Get one work order by id.',
    scope: 'supervisor:read',
    procedure: getWorkOrderProcedure,
  },
  {
    name: 'list_order_plans',
    description: 'List order plans of a project.',
    scope: 'supervisor:read',
    procedure: listOrderPlansProcedure,
  },
  {
    name: 'list_incidents',
    description: 'List Andon incidents of a project.',
    scope: 'supervisor:read',
    procedure: listIncidentsProcedure,
  },
  {
    name: 'transition_work_order',
    description: 'Apply an action to a work order.',
    scope: 'supervisor:write',
    procedure: transitionWorkOrderProcedure,
  },
  {
    name: 'transition_order_plan',
    description: 'Apply an action to an order plan.',
    scope: 'supervisor:write',
    procedure: transitionOrderPlanProcedure,
  },
  {
    name: 'resolve_incident',
    description: 'Resolve an Andon incident.',
    scope: 'supervisor:write',
    procedure: resolveIncidentProcedure,
  },
  {
    name: 'run_queue_action',
    description: 'Pause, unpause, reset, cancel or reprioritise queued orders.',
    scope: 'supervisor:write',
    procedure: queueActionsProcedure,
  },
  {
    name: 'import_todos',
    description: 'Import todo files into the queue (dry_run or apply).',
    scope: 'supervisor:write',
    procedure: importQueueProcedure,
  },
];

const SECTIONS = ['params', 'query', 'body'] as const;

export type McpTool = {
  name: string;
  description: string;
  scope: TokenScope;
  procedure: Procedure;
};

const inputSchemaOf = (procedure: Procedure): object => {
  const declared = procedure.contract.in ?? {};
  const shape: Record<string, z.ZodType> = {};
  for (const section of SECTIONS) {
    const schema = declared[section];
    if (schema !== undefined) shape[section] = schema;
  }
  return z.toJSONSchema(z.object(shape), { io: 'input' });
};

export const toolsFor = (scopes: readonly TokenScope[]) =>
  mcpTools
    .filter((tool) => scopes.includes(tool.scope))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchemaOf(tool.procedure),
    }));
