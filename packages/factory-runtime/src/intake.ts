import { createHash } from 'node:crypto';
import {
  orderIdOf,
  type BlobRef,
  type CommitSha,
  type OrderId,
  type ProjectId,
  type TodoId,
} from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import type { Spec } from '@repo/factory-core/order/events';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { IntakeRecord } from '@repo/factory-core/ports/intake';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { canonicalJson } from '@repo/factory-definitions/line-snapshot';
import { todoIdOf, type Todo } from '@repo/factory-definitions/todo';
import { scanTodos, type TodoScan } from '@repo/factory-definitions/todo-scan';
import {
  normaliseTodoText,
  todoContentHash,
} from '@repo/factory-definitions/todo-hash';
import type { CommandHandler } from './command-handler';
import { isRuntimeError } from './errors';
import type { RuntimePorts } from './ports';

/** What one intake pass did to one project (PROTOCOL §3.1, `POST /v1/intake/sync`). */
export interface IntakeReport {
  projectId: ProjectId;
  commit: CommitSha;
  created: TodoId[];
  updated: TodoId[];
  cancelled: TodoId[];
  /** Todos whose spec changed after their first claim: recorded, not applied (PROTOCOL §11). */
  specDrift: TodoId[];
  diagnostics: { todoId: string; kind: string; message: string }[];
}

/** Statuses after which a Work order takes no more intake commands. */
const TERMINAL = new Set<OrderProjection['status']>([
  'delivered',
  'merged',
  'cancelled',
]);

/** Stores a text as a blob and returns its `sha256:<hex>` ref. */
const putText = async (
  ports: RuntimePorts,
  text: string,
  mediaType: string,
): Promise<BlobRef> => {
  const bytes = new TextEncoder().encode(text);
  const ref =
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
  await ports.blobs.put(ref, bytes, mediaType);
  return ref;
};

/** A todo's title: its first top-level heading, else its id. */
const titleOf = (todo: Todo): string =>
  /^#\s+(.+)$/m.exec(todo.body)?.[1]?.trim() || todo.todoId;

/** The `spec` of a Work order: the todo body and normalised todo file as blobs, plus its hash. */
const specOf = async (
  ports: RuntimePorts,
  todo: Todo,
  text: string,
): Promise<Spec> => ({
  title: titleOf(todo),
  type: 'feat',
  bodyBlob: await putText(ports, todo.body, 'text/markdown'),
  contentHash: await putText(ports, normaliseTodoText(text), 'text/markdown'),
});

/** Whether a job was ever claimed for the Work order (any `job_claimed` in its events). */
const claimed = async (
  ports: RuntimePorts,
  orderId: OrderId,
): Promise<boolean> =>
  (await ports.events.load(orderId)).some(
    (stored) => stored.event.type === 'job_claimed',
  );

/** The detail of a refusal (a precondition or invalid command); other errors are not refusals. */
const refusalDetail = (error: unknown): string | undefined => {
  if (!isRuntimeError(error)) return undefined;
  const wire = error.wire;
  if (wire.code === 'precondition') return wire.detail;
  if (wire.code === 'invalid') return wire.issues.join('; ');
  return wire.code;
};

/**
 * One project's intake pass (STORAGE §4, ROADMAP M4). The mirror is fetched at the base branch, the
 * todo files are scanned, and each one is compared with its `intake` row:
 *
 * - a runnable `todo` with no Work order → `CreateOrder`;
 * - a changed spec → `UpdateSpec` before the first claim; after it, a `spec_drift` diagnostic only;
 * - `cancelled`, or a file that is gone → `Cancel` before the first claim; after it, a diagnostic;
 * - an unparseable todo, or one whose id is used by a finished Work order → a diagnostic, no command.
 *
 * Every command id derives from the todo and its hash, so a replayed pass changes nothing. The
 * caller holds the writer lock. A refusal becomes a diagnostic; any other error ends the pass, and
 * the next pass resumes from the rows already written.
 */
export const syncProject = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  project: ProjectRecord,
): Promise<IntakeReport> => {
  const { projectId } = project;
  const commit = await ports.git.sync({
    projectId,
    repoUrl: project.repoUrl,
    baseBranch: project.baseBranch,
  });
  const files = await ports.git.todoFiles(projectId, commit);
  const textOf = new Map(files.map((file) => [file.file, file.text]));
  const present = new Set(files.map((file) => todoIdOf(file.file)));
  const rows = await ports.projections.orders();
  const ordersById = new Map(rows.map((row) => [row.orderId, row]));
  const tracked = new Map(
    (await ports.intake.forProject(projectId)).map((record) => [
      record.todoId,
      record,
    ]),
  );
  // An order intake did not create keeps its id: a todo that reuses it is a reused_id (scanTodos).
  const knownOrderIds = new Set(
    rows
      .filter((row) => row.projectId === projectId && !tracked.has(row.todoId))
      .map((row) => row.orderId),
  );
  const scan: TodoScan = scanTodos(
    projectId,
    files,
    new Set(ports.definitions.lines.keys()),
    knownOrderIds,
    { requireV2: ports.config.v2Only },
  );

  const report: IntakeReport = {
    projectId,
    commit,
    created: [],
    updated: [],
    cancelled: [],
    specDrift: [],
    diagnostics: [],
  };

  const record = (
    todoId: TodoId,
    contentHash: string,
    diagnostic: string | null,
  ): Promise<void> => {
    const row: IntakeRecord = {
      projectId,
      todoId,
      contentHash,
      seenCommit: commit,
      diagnostic,
    };
    return ports.intake.upsert(row);
  };

  const diagnose = (todoId: TodoId, kind: string, message: string): string => {
    report.diagnostics.push({ todoId, kind, message });
    return `${kind}: ${message}`;
  };

  /** Runs one command. A refusal is returned as its diagnostic text; anything else is thrown. */
  const attempt = async (
    todoId: TodoId,
    run: () => Promise<void>,
  ): Promise<string | null> => {
    try {
      await run();
      return null;
    } catch (error) {
      const detail = refusalDetail(error);
      if (detail === undefined) throw error;
      return diagnose(todoId, 'refused', detail);
    }
  };

  const command = (
    orderId: OrderId,
    commandId: string,
    body: OrderCommand,
  ): Promise<void> =>
    handler
      .submit({ orderId, commandId, command: body, actor: { kind: 'factory' } })
      .then(() => undefined);

  for (const todo of scan.todos) {
    const text = textOf.get(todo.file) ?? '';
    const hash = todoContentHash(text);
    const row = tracked.get(todo.todoId);
    const order = ordersById.get(todo.orderId);
    const prefix = idPrefix(projectId, todo.todoId);

    if (todo.status === 'done') {
      await record(todo.todoId, hash, null);
      continue;
    }

    if (todo.status === 'cancelled') {
      if (!order || TERMINAL.has(order.status)) {
        await record(todo.todoId, hash, null);
        continue;
      }
      if (await claimed(ports, order.orderId)) {
        const diagnostic = diagnose(
          todo.todoId,
          'cancel_after_claim',
          'a job was claimed, so the cancel waits for the Supervisor',
        );
        await record(todo.todoId, row?.contentHash ?? hash, diagnostic);
        continue;
      }
      const diagnostic = await attempt(todo.todoId, async () => {
        await command(order.orderId, `${prefix}:cancelled:${hash}`, {
          type: 'Cancel',
          reason: 'the todo file was cancelled',
        });
        report.cancelled.push(todo.todoId);
      });
      await record(todo.todoId, hash, diagnostic);
      continue;
    }

    if (!order) {
      const diagnostic = await attempt(todo.todoId, async () => {
        const loaded = ports.definitions.lines.get(todo.line);
        if (!loaded) throw new Error(`unknown line ${todo.line}`);
        const snapshotBody = Object.fromEntries(
          Object.entries(loaded.snapshot).filter(([key]) => key !== 'hash'),
        );
        const snapshotBlob = await putText(
          ports,
          canonicalJson(snapshotBody),
          'application/json',
        );
        await command(todo.orderId, `${prefix}:${hash}`, {
          type: 'CreateOrder',
          projectId,
          todoId: todo.todoId,
          spec: await specOf(ports, todo, text),
          priority: todo.priority,
          dependsOn: todo.dependsOn,
          line: {
            name: loaded.snapshot.name,
            hash: loaded.snapshot.hash,
            snapshotBlob,
            snapshot: loaded.snapshot,
          },
          baseBranch: project.baseBranch,
        });
        report.created.push(todo.todoId);
      });
      await record(todo.todoId, hash, diagnostic);
      continue;
    }

    if (TERMINAL.has(order.status)) {
      const diagnostic = diagnose(
        todo.todoId,
        'reused_id',
        `order ${order.orderId} is ${order.status}; pick a new name`,
      );
      await record(todo.todoId, row?.contentHash ?? hash, diagnostic);
      continue;
    }

    if (!row || row.contentHash === hash) {
      await record(todo.todoId, hash, null);
      continue;
    }

    if (await claimed(ports, order.orderId)) {
      report.specDrift.push(todo.todoId);
      const diagnostic = diagnose(
        todo.todoId,
        'spec_drift',
        'the todo changed after its first claim; the Work order keeps its spec',
      );
      await record(todo.todoId, row.contentHash, diagnostic);
      continue;
    }
    const diagnostic = await attempt(todo.todoId, async () => {
      await command(order.orderId, `${prefix}:${hash}`, {
        type: 'UpdateSpec',
        spec: await specOf(ports, todo, text),
        priority: todo.priority,
        dependsOn: todo.dependsOn,
      });
      report.updated.push(todo.todoId);
    });
    await record(todo.todoId, hash, diagnostic);
  }

  // Todo files that could not become Work orders this pass: keep the old hash so a fix is seen as a change.
  const problems = new Map<TodoId, { kind: string; message: string }[]>();
  for (const problem of scan.diagnostics) {
    const todoId = todoIdOf(problem.file) as TodoId;
    const list = problems.get(todoId) ?? [];
    list.push({ kind: problem.kind, message: problem.message });
    problems.set(todoId, list);
  }
  for (const [todoId, list] of problems) {
    for (const problem of list) {
      report.diagnostics.push({
        todoId,
        kind: problem.kind,
        message: problem.message,
      });
    }
    const text =
      files.find((file) => todoIdOf(file.file) === todoId)?.text ?? '';
    await record(
      todoId,
      tracked.get(todoId)?.contentHash ?? todoContentHash(text),
      list.map((problem) => `${problem.kind}: ${problem.message}`).join('; '),
    );
  }

  // A tracked todo whose file is gone: cancel before the first claim, else diagnose.
  for (const row of tracked.values()) {
    if (present.has(row.todoId)) continue;
    const order = ordersById.get(orderIdOf(projectId, row.todoId));
    if (!order || TERMINAL.has(order.status)) continue;
    if (await claimed(ports, order.orderId)) {
      const diagnostic = diagnose(
        row.todoId,
        'removed_after_claim',
        'the todo file was removed after its first claim',
      );
      await record(row.todoId, row.contentHash, diagnostic);
      continue;
    }
    const diagnostic = await attempt(row.todoId, async () => {
      await command(
        order.orderId,
        `${idPrefix(projectId, row.todoId)}:removed:${row.contentHash}`,
        { type: 'Cancel', reason: 'the todo file was removed' },
      );
      report.cancelled.push(row.todoId);
    });
    await record(row.todoId, row.contentHash, diagnostic);
  }

  return report;
};

const idPrefix = (projectId: ProjectId, todoId: TodoId): string =>
  `intake:${projectId}:${todoId}`;
