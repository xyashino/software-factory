import { TransactionRollbackError, eq } from 'drizzle-orm';
import { z } from 'zod';
import { importQueueContract } from '@repo/hq-contracts/queue.contract';
import { immediateTx, type DbTx } from '../../../db/client';
import { workOrders } from '../../../db/schema/orders';
import { stateTransitions } from '../../../db/schema/transitions';
import { asCommandId, asOrderId, asPlanId } from '../../../domain/common/brand';
import { scopedId } from '../../../domain/common/scoped-id';
import {
  isStructurallyEditable,
  nextWorkOrderState,
  type WorkOrderState,
} from '../../../domain/orders/order-state';
import { findDependencyCycle } from '../../../domain/queue/dag';
import {
  parseTodoMarkdown,
  type TodoFile,
  type TodoStatus,
} from '../../../domain/queue/todo-markdown';
import {
  orderBranchOf,
  planBranchOf,
} from '../../../domain/topology/branch-names';
import { InternalServer } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  findPlan,
  flushTransitions,
  insertOrderPlan,
  insertWorkOrder,
  moveOrder,
  orderTransition,
  publishCommitted,
  requireProject,
  requirePlan,
  resolveFor,
  updateWorkOrder,
  type Actor,
  type TransitionLog,
  type WorkOrderInsert,
} from '../../orders/order-writes';
import type { ProjectRow, WorkOrderRow } from '../../orders/order-views';

const importCountsSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});

type ImportCounts = z.infer<typeof importCountsSchema>;

type ImportError = { filename: string; message: string };

type ParsedFile = { filename: string; todo: TodoFile };

type FileOutcome = keyof ImportCounts;

type ImportArgs = {
  projectId: string;
  commandId: string | undefined;
  dryRun: boolean;
  todos: readonly ParsedFile[];
  actor: Actor;
  now: number;
};

type ImportResult =
  | { kind: 'rejected'; errors: ImportError[] }
  | {
      kind: 'applied';
      counts: ImportCounts;
      records: ReturnType<typeof flushTransitions>;
    };

const parseFiles = (
  files: readonly { filename: string; markdown: string }[],
): { todos: ParsedFile[]; errors: ImportError[] } => {
  const todos: ParsedFile[] = [];
  const errors: ImportError[] = [];
  for (const file of files) {
    const result = parseTodoMarkdown(file.filename, file.markdown);
    if (result.ok) todos.push({ filename: file.filename, todo: result.todo });
    else errors.push({ filename: file.filename, message: result.error });
  }
  return { todos, errors };
};

const duplicateErrors = (todos: readonly ParsedFile[]): ImportError[] => {
  const seen = new Set<string>();
  return todos.flatMap((item) => {
    if (!seen.has(item.todo.slug)) {
      seen.add(item.todo.slug);
      return [];
    }
    return [
      {
        filename: item.filename,
        message: 'slug appears more than once in this import',
      },
    ];
  });
};

const graphErrors = (
  todos: readonly ParsedFile[],
  existing: ReadonlyMap<string, string | null>,
): ImportError[] => {
  const parentOf = new Map(existing);
  for (const item of todos) parentOf.set(item.todo.slug, item.todo.dependsOn);
  const unknown = todos.flatMap((item) => {
    const parent = item.todo.dependsOn;
    if (parent === null || parentOf.has(parent)) return [];
    return [
      {
        filename: item.filename,
        message: `depends_on ${parent} is not a known work order`,
      },
    ];
  });
  if (unknown.length > 0) return unknown;
  const cycle = findDependencyCycle(parentOf);
  return cycle === null
    ? []
    : [{ filename: `${cycle}.md`, message: 'depends_on forms a cycle' }];
};

const topoOrder = (todos: readonly ParsedFile[]): ParsedFile[] => {
  const bySlug = new Map(todos.map((item) => [item.todo.slug, item]));
  const visited = new Set<string>();
  const ordered: ParsedFile[] = [];
  const visit = (item: ParsedFile): void => {
    if (visited.has(item.todo.slug)) return;
    visited.add(item.todo.slug);
    const parent = item.todo.dependsOn;
    const parentItem = parent === null ? undefined : bySlug.get(parent);
    if (parentItem !== undefined) visit(parentItem);
    ordered.push(item);
  };
  for (const item of todos) visit(item);
  return ordered;
};

const stateFor = (
  state: WorkOrderState,
  status: TodoStatus,
  isReady: boolean,
): WorkOrderState => {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'paused')
    return nextWorkOrderState(state, 'pause', isReady) ?? state;
  if (state === 'paused')
    return nextWorkOrderState(state, 'unpause', isReady) ?? state;
  if (state === 'queued' || state === 'waiting_parent')
    return isReady ? 'queued' : 'waiting_parent';
  return state;
};

const differs = (
  row: WorkOrderRow,
  patch: Partial<WorkOrderInsert>,
): boolean => {
  const current = new Map<string, unknown>(Object.entries(row));
  return Object.entries(patch).some(
    ([key, value]) =>
      JSON.stringify(current.get(key)) !== JSON.stringify(value),
  );
};

const storedCounts = (meta: Record<string, unknown> | null): ImportCounts => {
  const parsed = importCountsSchema.safeParse(meta?.result);
  if (!parsed.success)
    throw new InternalServer('Stored queue import result is unreadable');
  return parsed.data;
};

const ensurePlans = (
  tx: DbTx,
  project: ProjectRow,
  todos: readonly ParsedFile[],
  actor: Actor,
  now: number,
  log: TransitionLog,
): void => {
  const planSlugs = new Set(
    todos.flatMap((item) => (item.todo.plan === null ? [] : [item.todo.plan])),
  );
  for (const slug of planSlugs) {
    const planId = scopedId(project.projectId, slug);
    if (findPlan(tx, planId) !== undefined) continue;
    insertOrderPlan(tx, {
      planId: asPlanId(planId),
      projectId: project.projectId,
      slug,
      title: slug,
      baseBranch: project.defaultBaseBranch,
      branch: planBranchOf(slug),
      branchCommitSha: null,
      state: 'draft',
      failureDetail: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    log.push(
      orderTransition({
        projectId: project.projectId,
        entityType: 'order_plan',
        entityId: planId,
        fromState: null,
        toState: 'draft',
        actor,
        at: now,
      }),
    );
  }
};

const applyFile = (
  tx: DbTx,
  project: ProjectRow,
  item: ParsedFile,
  orders: Map<string, WorkOrderRow>,
  actor: Actor,
  now: number,
  log: TransitionLog,
): FileOutcome => {
  const { todo } = item;
  const current = orders.get(todo.slug);
  const plan =
    todo.plan === null
      ? null
      : requirePlan(tx, scopedId(project.projectId, todo.plan));
  const parent =
    todo.dependsOn === null ? null : (orders.get(todo.dependsOn) ?? null);
  const resolved = resolveFor(
    { baseBranch: project.defaultBaseBranch, branch: orderBranchOf(todo.slug) },
    plan,
    parent,
  );
  const planId = plan?.planId ?? null;
  const parentOrderId = parent?.orderId ?? null;

  if (current === undefined) {
    const orderId = asOrderId(scopedId(project.projectId, todo.slug));
    const state =
      todo.status === 'queued' ? resolved.initialState : todo.status;
    const row = insertWorkOrder(tx, {
      orderId,
      projectId: project.projectId,
      planId,
      parentOrderId,
      slug: todo.slug,
      title: todo.title,
      type: todo.type,
      description: todo.description,
      lineName: todo.line,
      unavailableLineFactoriesJson: [],
      priority: todo.priority,
      baseBranch: resolved.baseBranch,
      baseCommitSha: resolved.baseCommitSha,
      branch: orderBranchOf(todo.slug),
      state,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    orders.set(todo.slug, row);
    log.push(
      orderTransition({
        projectId: project.projectId,
        entityType: 'work_order',
        entityId: orderId,
        fromState: null,
        toState: state,
        actor,
        at: now,
      }),
    );
    return 'created';
  }

  if (!isStructurallyEditable(current.state)) {
    if (todo.status === 'cancelled') {
      const next = nextWorkOrderState(
        current.state,
        'cancel',
        resolved.isReady,
      );
      if (next !== null) {
        orders.set(
          todo.slug,
          moveOrder(tx, current, next, 'cancel', actor, now, log),
        );
        return 'updated';
      }
    }
    if (current.priority === todo.priority) return 'skipped';
    const row = updateWorkOrder(tx, current, { priority: todo.priority }, now);
    log.push(
      orderTransition({
        projectId: project.projectId,
        entityType: 'work_order',
        entityId: current.orderId,
        fromState: current.state,
        toState: current.state,
        actor,
        at: now,
      }),
    );
    orders.set(todo.slug, row);
    return 'updated';
  }

  const next = stateFor(current.state, todo.status, resolved.isReady);
  const patch: Partial<WorkOrderInsert> = {
    state: next,
    title: todo.title,
    description: todo.description,
    priority: todo.priority,
    type: todo.type,
    lineName: todo.line,
    planId,
    parentOrderId,
    baseBranch: resolved.baseBranch,
    baseCommitSha: resolved.baseCommitSha,
  };
  if (todo.line !== current.lineName) patch.unavailableLineFactoriesJson = [];
  if (!differs(current, patch)) return 'skipped';
  const row = updateWorkOrder(tx, current, patch, now);
  orders.set(todo.slug, row);
  log.push(
    orderTransition({
      projectId: project.projectId,
      entityType: 'work_order',
      entityId: current.orderId,
      fromState: current.state,
      toState: next,
      actor,
      at: now,
    }),
  );
  return 'updated';
};

const importInTx = (tx: DbTx, args: ImportArgs): ImportResult => {
  const project = requireProject(tx, args.projectId);
  const commandId =
    args.commandId === undefined ? undefined : asCommandId(args.commandId);
  if (commandId !== undefined && !args.dryRun) {
    const prior = tx
      .select()
      .from(stateTransitions)
      .where(eq(stateTransitions.commandId, commandId))
      .get();
    if (prior !== undefined)
      return {
        kind: 'applied',
        counts: storedCounts(prior.metaJson),
        records: [],
      };
  }

  const rows = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.projectId, project.projectId))
    .all();
  const orders = new Map(rows.map((row) => [row.slug, row]));
  const slugById = new Map(rows.map((row) => [row.orderId, row.slug]));
  const existingParents = new Map(
    rows.map((row) => [
      row.slug,
      row.parentOrderId === null
        ? null
        : (slugById.get(row.parentOrderId) ?? null),
    ]),
  );
  const problems = graphErrors(args.todos, existingParents);
  if (problems.length > 0) return { kind: 'rejected', errors: problems };

  const log: TransitionLog = [];
  ensurePlans(tx, project, args.todos, args.actor, args.now, log);
  const counts: ImportCounts = { created: 0, updated: 0, skipped: 0 };
  for (const item of topoOrder(args.todos))
    counts[applyFile(tx, project, item, orders, args.actor, args.now, log)] +=
      1;

  if (args.dryRun) return { kind: 'applied', counts, records: [] };
  return {
    kind: 'applied',
    counts,
    records: flushTransitions(
      tx,
      log,
      commandId === undefined
        ? undefined
        : { commandId, meta: { result: counts } },
    ),
  };
};

export const importQueueProcedure = scopedProcedure(['operator:write'])(
  importQueueContract,
)((input, ctx) => {
  const { projectId, mode, files, commandId } = input.body;
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'operator', id: ctx.principal.tokenId };
  const dryRun = mode === 'dry_run';
  const parsed = parseFiles(files);
  const preErrors = [...parsed.errors, ...duplicateErrors(parsed.todos)];

  if (preErrors.length > 0)
    return {
      code: 422 as const,
      type: 'unprocessable-entity' as const,
      message: 'Queue import rejected',
      errors: preErrors,
    };

  const holder: { result?: ImportResult } = {};
  try {
    immediateTx(ctx.db, (tx) => {
      holder.result = importInTx(tx, {
        projectId,
        commandId,
        dryRun,
        todos: parsed.todos,
        actor,
        now,
      });
      if (dryRun) tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }

  const result = holder.result;
  if (result === undefined)
    throw new InternalServer('Queue import produced no result');
  if (result.kind === 'rejected')
    return {
      code: 422 as const,
      type: 'unprocessable-entity' as const,
      message: 'Queue import rejected',
      errors: result.errors,
    };
  publishCommitted(ctx, result.records);
  return { code: 200 as const, mode, ...result.counts, errors: [] };
});
