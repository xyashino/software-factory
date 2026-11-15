import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { ParsedRequest } from '@repo/factory-core/contracts/routes';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import {
  orderIdOf,
  planIdOf,
  type OrderId,
  type PlanId,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { Actor, Spec } from '@repo/factory-core/order/events';
import {
  orderCommandSchema,
  type CommandOf,
} from '@repo/factory-core/order/commands';
import { planCommandSchema } from '@repo/factory-core/plan/commands';
import {
  canonicalJson,
  hashLine,
} from '@repo/factory-definitions/line-snapshot';
import type { CommandHandler } from './command-handler';
import { notFound, refusal } from './errors';
import { storeText } from './job-builder';
import type { RuntimePorts } from './ports';

/**
 * The task API (PROTOCOL §3.3, CORE §4.4, §12.3): Work orders and Order Plans are created from a body and a
 * pinned `LineSnapshot`, never from a repo definition on the server. Each route appends through the same
 * `CommandHandler` as every other command, so a replayed `commandId` returns its stored response.
 */

/**
 * The actor every task-API command records. The route's credential is the Supervisor's, but these commands are
 * the factory's own writes (CORE §5.2, §12.3): intake and PR polling record the same actor. Only a supervisor
 * token reaches these routes (`auth: 'supervisor'`).
 */
const FACTORY: Actor = { kind: 'factory' };

/** The body-and-Line part of a Work order, shared by a single order and each plan member. */
interface SpecInput {
  todoId: ParsedRequest<'createOrder'>['todoId'];
  title: string;
  type: Spec['type'];
  body: string;
  line: LineSnapshot;
  priority: ParsedRequest<'createOrder'>['priority'];
}

/** The Line a Work order pins (CORE §4.4): its name, hash, snapshot blob and snapshot. */
type PinnedLine = CommandOf<'CreateOrder'>['line'];

/** A Line as the order pins it: the snapshot's blob (without its hash, as intake stores it) and the hash. */
const pinLine = async (
  ports: RuntimePorts,
  line: LineSnapshot,
): Promise<PinnedLine> => {
  const hash = hashLine(line);
  if (hash !== line.hash) {
    throw refusal({
      code: 'invalid',
      issues: [`line ${line.name} hash does not match its snapshot`],
    });
  }
  const body = Object.fromEntries(
    Object.entries(line).filter(([key]) => key !== 'hash'),
  );
  return {
    name: line.name,
    hash: line.hash,
    snapshotBlob: await storeText(
      ports.blobs,
      canonicalJson(body),
      'application/json',
    ),
    snapshot: line,
  };
};

/** The spec of a Work order: its markdown body as a blob, and a content hash over the spec's fields. */
const specOf = async (
  ports: RuntimePorts,
  input: SpecInput,
  dependsOn: readonly OrderId[],
): Promise<Spec> => ({
  title: input.title,
  type: input.type,
  bodyBlob: await storeText(ports.blobs, input.body, 'text/markdown'),
  contentHash: await storeText(
    ports.blobs,
    canonicalJson({
      title: input.title,
      type: input.type,
      body: input.body,
      priority: input.priority,
      dependsOn,
      line: input.line.hash,
    }),
    'application/json',
  ),
});

const requireResult = (result: CommandResult | undefined): CommandResult => {
  if (!result) throw new Error('a command that may not skip returned nothing');
  return result;
};

/** The project's base branch, the default a Work order or plan takes when the request names none. */
const baseBranchOf = async (
  ports: RuntimePorts,
  projectId: ProjectId,
): Promise<string> => {
  const project = (await ports.projects.list()).find(
    (candidate) => candidate.projectId === projectId,
  );
  if (!project) throw notFound();
  return project.baseBranch;
};

interface OrderInput extends SpecInput {
  commandId: string;
  projectId: ProjectId;
  baseBranch: string;
  dependsOn: readonly OrderId[];
  plan?: ParsedRequest<'createOrder'>['plan'];
}

/** One Work order, created with its spec and pinned Line (CORE §4.4, `CreateOrder`). */
const submitOrder = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  input: OrderInput,
): Promise<CommandResult & { orderId: OrderId }> => {
  ports.writer.assertHeld();
  const orderId = orderIdOf(input.projectId, input.todoId);
  const command = orderCommandSchema.parse({
    type: 'CreateOrder',
    projectId: input.projectId,
    todoId: input.todoId,
    spec: await specOf(ports, input, input.dependsOn),
    priority: input.priority,
    dependsOn: [...input.dependsOn],
    line: await pinLine(ports, input.line),
    baseBranch: input.baseBranch,
    ...(input.plan === undefined ? {} : { plan: input.plan }),
  });
  const result = await handler.submit({
    orderId,
    commandId: input.commandId,
    command,
    actor: FACTORY,
  });
  return { ...requireResult(result), orderId };
};

/**
 * A Line snapshot with its content hash, as a caller pins it (CORE §4.4). The hash is `factory-definitions`'s, so a
 * caller that builds its snapshot body outside the definitions gets the same value the runtime verifies.
 */
export const pinnableLine = (
  body: Omit<LineSnapshot, 'hash'>,
): LineSnapshot => ({ ...body, hash: hashLine(body) });

/** `POST /v1/orders`: one Work order from its spec and a pinned Line. Idempotent by `commandId`. */
export const createOrder = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  request: ParsedRequest<'createOrder'>,
): Promise<CommandResult & { orderId: OrderId }> => {
  const baseBranch =
    request.baseBranch ?? (await baseBranchOf(ports, request.projectId));
  return submitOrder(ports, handler, { ...request, baseBranch });
};

/**
 * `POST /v1/plans`: an Order Plan and its members in chain order (CORE §12.7): `CreatePlan`, then each member's
 * `CreateOrder` with the plan and its predecessor as dependency, then `AddPlanMember` after that predecessor.
 * Each sub-command id derives from the request's `commandId`, so a replay appends nothing.
 */
export const createPlan = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  request: ParsedRequest<'createPlan'>,
): Promise<{
  planId: PlanId;
  orderIds: OrderId[];
  dryRun: false;
  events: CommandResult['events'];
  next: null;
}> => {
  ports.writer.assertHeld();
  const { projectId, slug, commandId } = request;
  const planId = planIdOf(projectId, slug);
  const baseBranch =
    request.baseBranch ?? (await baseBranchOf(ports, projectId));
  const actor = FACTORY;
  await handler.submitPlan({
    planId,
    commandId: `${commandId}:plan`,
    command: planCommandSchema.parse({
      type: 'CreatePlan',
      planId,
      projectId,
      slug,
      baseBranch,
    }),
    actor,
  });

  const orderIds: OrderId[] = [];
  const events: CommandResult['events'] = [];
  let after: OrderId | undefined;
  for (const member of request.members) {
    const created = await submitOrder(ports, handler, {
      ...member,
      commandId: `${commandId}:order:${member.todoId}`,
      projectId,
      baseBranch,
      plan: slug,
      dependsOn: after === undefined ? [] : [after],
    });
    const added = await handler.submitPlan({
      planId,
      commandId: `${commandId}:member:${member.todoId}`,
      command: planCommandSchema.parse({
        type: 'AddPlanMember',
        orderId: created.orderId,
        todoId: member.todoId,
        ...(after === undefined ? {} : { after }),
      }),
      actor,
    });
    events.push(...created.events, ...added.events);
    orderIds.push(created.orderId);
    after = created.orderId;
  }
  return { planId, orderIds, dryRun: false, events, next: null };
};

/** `POST /v1/orders/:id/pr-state`: a Work order's PR is open, merged or closed (`RecordPrState`). */
export const recordPrState = async (
  handler: CommandHandler,
  request: ParsedRequest<'recordPrState'>,
): Promise<CommandResult> =>
  requireResult(
    await handler.submit({
      orderId: request.orderId,
      commandId: request.commandId,
      command: orderCommandSchema.parse({
        type: 'RecordPrState',
        prUrl: request.prUrl,
        state: request.state,
      }),
      actor: FACTORY,
    }),
  );

/** `POST /v1/plans/:id/pr-state`: an Order Plan's PR state (`RecordPlanPrState`). */
export const recordPlanPrState = async (
  handler: CommandHandler,
  request: ParsedRequest<'recordPlanPrState'>,
): Promise<{
  dryRun: boolean;
  events: CommandResult['events'];
  next: null;
}> => {
  const result = await handler.submitPlan({
    planId: request.planId,
    commandId: request.commandId,
    command: planCommandSchema.parse({
      type: 'RecordPlanPrState',
      prUrl: request.prUrl,
      state: request.state,
    }),
    actor: FACTORY,
  });
  return { dryRun: result.dryRun, events: result.events, next: null };
};
