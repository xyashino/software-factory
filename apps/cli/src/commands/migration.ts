import {
  orderIdOf,
  todoIdSchema,
  type OrderId,
  type PlanSlug,
  type ProjectId,
} from '@repo/factory-core/ids';
import { splitFrontmatter } from '@repo/factory-definitions/frontmatter';
import {
  parseTodo,
  todoIdOf,
  type Todo,
  type TodoDiagnostic,
  type TodoSource,
} from '@repo/factory-definitions/todo';
import {
  scanTodos,
  type TodoFileState,
} from '@repo/factory-definitions/todo-scan';

/**
 * What `todos migrate` does with one todo file:
 * - `would-create`: a dry run would create it;
 * - `created`: the server confirmed the create;
 * - `skipped`: the server already has it, or the file is not one this run takes (done, cancelled,
 *   or not `factory: v2` without `--all`);
 * - `error`: the file cannot migrate (a diagnostic, a blocked dependency, or a server refusal).
 */
export type MigrationOutcome = 'would-create' | 'created' | 'skipped' | 'error';

/** One file's result. `target` is its Work order id, or `plan:<slug>` for a plan's files. */
export interface MigrationItem {
  file: string;
  outcome: MigrationOutcome;
  target: string;
  reason: string;
  /** true when the server has this file's work: created now, or already there (`--remove` may delete it) */
  onServer: boolean;
}

/** One Order Plan to create: its members in chain order, each from its own file. */
export interface PlanUnit {
  slug: PlanSlug;
  members: Todo[];
}

/** One standalone Work order to create, with the OrderIds its `dependsOn` sends to the server. */
export interface OrderUnit {
  todo: Todo;
  dependsOn: OrderId[];
}

export interface MigrationPlan {
  /** plans, sorted by slug; created before any standalone order (a plan has no outside dependencies) */
  plans: PlanUnit[];
  /** standalone orders in dependency order: a dependency comes before its dependents */
  orders: OrderUnit[];
  /** one item per todo file, sorted by file */
  items: MigrationItem[];
  /** every problem found, one per file and cause */
  diagnostics: TodoDiagnostic[];
}

export interface MigrationInput {
  projectId: ProjectId;
  /** every `.md` file of the todos directory, `file` relative to the repo root */
  sources: readonly TodoSource[];
  /** the Line names of the repo's `.factory/lines/` */
  lines: ReadonlySet<string>;
  /** OrderIds the server already has (any project); such a file is skipped, never scanned */
  existingOrderIds: ReadonlySet<OrderId>;
  /** plan slugs the server already has in this project */
  existingPlanSlugs: ReadonlySet<PlanSlug>;
  /** `--all`: migrate every runnable todo; otherwise only `factory: v2` ones. */
  all: boolean;
}

// The OrderId a todo file would take, or its path when the file name is not a todo id.
const targetOf = (projectId: ProjectId, file: string): string => {
  const id = todoIdSchema.safeParse(todoIdOf(file));
  return id.success ? orderIdOf(projectId, id.data) : file;
};

// The status of every todo file keyed by OrderId; a file that does not parse is `unparseable`.
const fileStatesOf = (
  projectId: ProjectId,
  sources: readonly TodoSource[],
): Map<OrderId, TodoFileState> => {
  const states = new Map<OrderId, TodoFileState>();
  for (const source of sources) {
    const id = todoIdSchema.safeParse(todoIdOf(source.file));
    if (!id.success) continue;
    const parsed = parseTodo(projectId, source.file, source.text);
    states.set(
      orderIdOf(projectId, id.data),
      parsed.ok ? parsed.value.todo.status : 'unparseable',
    );
  }
  return states;
};

/** `type=feat`, marked `(default)` when the frontmatter names no type: visible before any write. */
export const typeNote = (
  source: TodoSource | undefined,
  todo: Todo,
): string => {
  const frontmatter =
    source === undefined
      ? ''
      : (splitFrontmatter(source.text)?.frontmatter ?? '');
  const explicit = /^type:/m.test(frontmatter);
  return `type=${todo.type}${explicit ? '' : ' (default)'}`;
};

/**
 * Plans one `todos migrate` run, pure: which files are created, which are skipped and why, and the
 * order to create them in. No I/O: the caller reads the files and the server's existing ids.
 *
 * Rules:
 * - a file whose OrderId the server has is skipped before the scan, so the scan never reports
 *   `reused_id` for it: re-running is idempotent;
 * - a plan the server has is skipped with all its files;
 * - the rest goes through `scanTodos`: a diagnostic blocks its file, and a plan whose chain or
 *   members are wrong creates nothing;
 * - a plan member may depend only on the member before it (the server builds the chain from order);
 * - a standalone todo's dependency is sent as `dependsOn` when the server or this run has it, and is
 *   satisfied when its file is `done` or gone; any other dependency blocks the todo, and so does a
 *   blocked dependency (ADR clarify-missing-dependency-rule).
 */
export const planMigration = (input: MigrationInput): MigrationPlan => {
  const { projectId, existingOrderIds, existingPlanSlugs } = input;
  const items = new Map<string, MigrationItem>();
  const note = (
    file: string,
    outcome: MigrationOutcome,
    target: string,
    reason: string,
    onServer = false,
  ): void => {
    items.set(file, { file, outcome, target, reason, onServer });
  };
  const sourceOf = new Map(input.sources.map((s) => [s.file, s]));

  // 1. Files whose order the server already has: skipped, never scanned.
  const pending: TodoSource[] = [];
  for (const source of input.sources) {
    const id = todoIdSchema.safeParse(todoIdOf(source.file));
    const orderId = id.success ? orderIdOf(projectId, id.data) : undefined;
    if (orderId !== undefined && existingOrderIds.has(orderId)) {
      note(source.file, 'skipped', orderId, 'exists on the server', true);
      continue;
    }
    pending.push(source);
  }

  // 2. Files of a plan the server already has: skipped with the plan.
  const scannable: TodoSource[] = [];
  for (const source of pending) {
    const parsed = parseTodo(projectId, source.file, source.text);
    const slug = parsed.ok ? parsed.value.todo.plan : undefined;
    if (slug !== undefined && existingPlanSlugs.has(slug)) {
      note(
        source.file,
        'skipped',
        `plan:${slug}`,
        `plan ${slug} exists on the server`,
        true,
      );
      continue;
    }
    scannable.push(source);
  }

  // 3. The scan over what is left. A diagnostic blocks its own file.
  const scan = scanTodos(projectId, scannable, input.lines, new Set(), {
    requireV2: !input.all,
  });
  const diagnostics = [...scan.diagnostics];
  for (const d of scan.diagnostics) {
    if (!items.has(d.file)) {
      note(
        d.file,
        'error',
        targetOf(projectId, d.file),
        `${d.kind}: ${d.message}`,
      );
    }
  }
  const migratable = new Set(scan.todos.map((todo) => todo.file));
  for (const source of scannable) {
    if (items.has(source.file) || migratable.has(source.file)) continue;
    note(
      source.file,
      'skipped',
      source.file,
      'not factory: v2 (use --all to migrate it)',
    );
  }
  for (const todo of scan.todos) {
    if (todo.status !== 'todo') {
      note(todo.file, 'skipped', todo.orderId, `${todo.status}, not migrated`);
    }
  }
  const runnable = scan.todos.filter((todo) => todo.status === 'todo');

  // 4. Units: a plan, or one standalone todo. A blocked unit gets a reason; so does what depends on it.
  const unitOf = new Map<OrderId, string>();
  for (const todo of runnable) {
    unitOf.set(
      todo.orderId,
      todo.plan === undefined ? todo.orderId : `plan:${todo.plan}`,
    );
  }
  const stateOf = fileStatesOf(projectId, input.sources);
  const blocked = new Map<string, string>();
  const chains = [...scan.planChains]
    .filter(([slug]) => !existingPlanSlugs.has(slug))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [slug, members] of chains) {
    const memberIds = new Set(members.map((member) => member.orderId));
    members.forEach((member, index) => {
      const predecessor = index === 0 ? undefined : members[index - 1]?.orderId;
      for (const dep of member.dependsOn) {
        if (dep === predecessor || memberIds.has(dep)) continue;
        const state = stateOf.get(dep);
        if (
          state === 'done' ||
          (state === undefined && !existingOrderIds.has(dep))
        ) {
          continue;
        }
        blocked.set(
          `plan:${slug}`,
          `${member.todoId} depends on ${dep}, which a plan member cannot express`,
        );
      }
    });
  }

  for (const todo of runnable) {
    if (todo.plan !== undefined) continue;
    for (const dep of todo.dependsOn) {
      if (existingOrderIds.has(dep) || unitOf.has(dep)) continue;
      const state = stateOf.get(dep);
      if (state === undefined || state === 'done') continue;
      blocked.set(
        todo.orderId,
        `depends on ${dep}, which is not migrated (${state})`,
      );
    }
  }

  // A unit that depends on a blocked unit is blocked too, until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const todo of runnable) {
      const unit = unitOf.get(todo.orderId) ?? todo.orderId;
      if (blocked.has(unit)) continue;
      const hit = todo.dependsOn.find((dep) => {
        const other = unitOf.get(dep);
        return other !== undefined && blocked.has(other);
      });
      if (hit !== undefined) {
        blocked.set(unit, `depends on ${hit}, which is blocked`);
        changed = true;
      }
    }
  }

  // 5. Standalone order: a dependency first. A cycle blocks what it cannot order.
  const standalone = runnable.filter(
    (todo) => todo.plan === undefined && !blocked.has(todo.orderId),
  );
  const ordered: Todo[] = [];
  const placed = new Set<OrderId>();
  for (let progressing = true; progressing;) {
    progressing = false;
    for (const todo of standalone) {
      if (placed.has(todo.orderId)) continue;
      const waiting = todo.dependsOn.some(
        (dep) =>
          standalone.some((other) => other.orderId === dep) && !placed.has(dep),
      );
      if (waiting) continue;
      placed.add(todo.orderId);
      ordered.push(todo);
      progressing = true;
    }
  }
  for (const todo of standalone) {
    if (!placed.has(todo.orderId))
      blocked.set(todo.orderId, 'dependency cycle');
  }

  // 6. Items: planned, or blocked with the reason.
  const planUnits: PlanUnit[] = [];
  for (const [slug, members] of chains) {
    const why = blocked.get(`plan:${slug}`);
    if (why !== undefined) {
      for (const member of members)
        note(member.file, 'error', `plan:${slug}`, why);
      continue;
    }
    planUnits.push({ slug, members });
    for (const member of members) {
      const label = typeNote(sourceOf.get(member.file), member);
      note(
        member.file,
        'would-create',
        member.orderId,
        `plan ${slug}, ${label}`,
      );
    }
  }

  const migrating = new Set<OrderId>(runnable.map((todo) => todo.orderId));
  const orderUnits: OrderUnit[] = [];
  for (const todo of ordered) {
    orderUnits.push({
      todo,
      dependsOn: todo.dependsOn.filter(
        (dep) => existingOrderIds.has(dep) || migrating.has(dep),
      ),
    });
    note(
      todo.file,
      'would-create',
      todo.orderId,
      `standalone, ${typeNote(sourceOf.get(todo.file), todo)}`,
    );
  }
  for (const todo of runnable) {
    const why = todo.plan === undefined ? blocked.get(todo.orderId) : undefined;
    if (why !== undefined) note(todo.file, 'error', todo.orderId, why);
  }

  return {
    plans: planUnits,
    orders: orderUnits,
    items: [...items.values()].sort((a, b) => a.file.localeCompare(b.file)),
    diagnostics,
  };
};
