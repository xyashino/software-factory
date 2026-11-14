import { createHash } from 'node:crypto';
import { jobSchema, type Job } from '@repo/factory-core/contracts/job';
import type { BlobRef, CommitSha, JobId } from '@repo/factory-core/ids';
import type { PlanJobKind } from '@repo/factory-core/plan/events';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import { findStation } from '@repo/factory-core/line/snapshot';
import { resolveCycleContext } from '@repo/factory-core/order/context';
import type { JobSpec } from '@repo/factory-core/order/next';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { planBranchOf } from '@repo/factory-core/ids';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import type { Line, LineStation } from '@repo/factory-definitions/line-schema';
import type { Definitions } from '@repo/factory-definitions/load';
import { buildPrompt } from './prompts/build-prompt';
import { refusal } from './errors';
import type { RuntimeConfig } from './ports';

export interface JobPorts {
  blobs: BlobStore;
  definitions: Definitions;
  config: RuntimeConfig;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The `sha256:<hex>` ref of text, stored as a blob. A prompt is stored once, however often it is built. */
export const storeText = async (
  blobs: BlobStore,
  text: string,
  mediaType: string,
): Promise<BlobRef> => {
  const bytes = encoder.encode(text);
  const ref =
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
  await blobs.put(ref, bytes, mediaType);
  return ref;
};

const textOf = async (blobs: BlobStore, ref: BlobRef): Promise<string> => {
  const bytes = await blobs.get(ref);
  return bytes ? decoder.decode(bytes) : '';
};

const lineOf = (definitions: Definitions, name: string): Line => {
  const loaded = definitions.lines.get(name);
  if (!loaded) {
    throw refusal({
      code: 'precondition',
      detail: `line ${name} is not in the loaded definitions`,
    });
  }
  return loaded.line;
};

const baseOf = (
  base: CommitSha | 'branch_base',
  branchBase: string,
): CommitSha | { branchBase: string } =>
  base === 'branch_base' ? { branchBase } : base;

/**
 * The branch a Work order builds on, resolved when the job is built (CORE §12.5, never stored):
 * - a plain Work order: its pinned `baseBranch`, not the project's current one;
 * - a plan member with no in-plan predecessor (the root), or whose predecessor's PR is merged: `feat/<slug>`;
 * - a plan member whose predecessor is delivered with its PR not merged: `factory/<predecessorTodoId>`.
 */
export const resolveBase = (
  state: Pick<WorkOrderState, 'plan' | 'dependsOn' | 'baseBranch'>,
  rows: readonly OrderProjection[],
): string => {
  if (state.plan === undefined) return state.baseBranch;
  const plan = state.plan;
  const predecessor = state.dependsOn
    .map((orderId) => rows.find((row) => row.orderId === orderId))
    .find((row) => row?.plan === plan);
  if (predecessor === undefined || predecessor.prState === 'merged') {
    return planBranchOf(plan);
  }
  return `factory/${predecessor.todoId}`;
};

/**
 * The Job a claimed job becomes (PROTOCOL §4). `spec` is the job `nextJob` named before the claim,
 * `state` the state after it; every path is relative and the prompt is stored as a blob, referenced by
 * ref. Pure apart from the blob reads and the one prompt blob write.
 */
export const buildJob = async (
  ports: JobPorts,
  state: WorkOrderState,
  project: ProjectRecord,
  spec: JobSpec,
  rows: readonly OrderProjection[] = [],
): Promise<Job> => {
  const active = state.activeJob;
  if (!active) {
    throw refusal({ code: 'precondition', detail: 'no job is active' });
  }
  const next: { kind: 'job'; job: JobSpec } = { kind: 'job', job: spec };
  const line = lineOf(ports.definitions, state.line.name);
  const branchBase = resolveBase(state, rows);
  const common = {
    jobId: active.jobId,
    orderId: state.orderId,
    projectId: state.projectId,
    epoch: active.epoch,
    repo: {
      url: project.repoUrl,
      baseBranch: branchBase,
      branch: `factory/${state.todoId}`,
    },
    workspace: {
      dir: state.todoId,
      sync: line.workspace.sync?.exec ?? [],
      setup: line.workspace.setup.exec,
      timeoutMs: line.workspace.setup.timeoutMs,
    },
  };

  if (next.job.kind === 'deliver') {
    const bodyBlob = state.spec.bodyBlob;
    return jobSchema.parse({
      ...common,
      kind: 'deliver',
      base: next.job.base,
      deliver: {
        title: state.spec.title,
        bodyBlob,
        commitMessage: richCommitOf(
          state.spec.type,
          state.spec.title,
          state.todoId,
        ),
        removeTodo: `todos/${state.todoId}.md`,
      },
    });
  }

  const { stationId, n, cause } = next.job;
  const station = findStation(state.line, stationId);
  const lineStation = line.stations.find(
    (candidate): candidate is LineStation => candidate.id === stationId,
  );
  if (!station || !lineStation) {
    throw refusal({
      code: 'precondition',
      detail: `station ${stationId} is not in line ${line.name}`,
    });
  }
  const base = baseOf(next.job.base, branchBase);
  const stationBase = {
    stationId,
    cycleId: active.cycleId ?? stationCycleMissing(),
    n,
    cause,
  };

  if (next.job.kind === 'run_inspection') {
    if (lineStation.kind !== 'inspection') {
      throw refusal({
        code: 'precondition',
        detail: `station ${stationId} is not an inspection`,
      });
    }
    return jobSchema.parse({
      ...common,
      kind: 'run_inspection',
      base,
      station: {
        ...stationBase,
        exec: station.exec ?? [],
        inspectionTimeoutMs:
          lineStation.timeoutMs || ports.config.inspectionTimeoutMs,
      },
    });
  }

  if (lineStation.kind !== 'operator') {
    throw refusal({
      code: 'precondition',
      detail: `station ${stationId} is not an operator station`,
    });
  }
  const pool = line.operators[lineStation.operator];
  const profile = pool
    ? ports.definitions.operators.get(pool.profile)
    : undefined;
  if (!pool || !profile) {
    throw refusal({
      code: 'precondition',
      detail: `station ${stationId} names no loaded operator`,
    });
  }

  const context = resolveCycleContext(state, stationId, cause);
  const inputs = context.inputs.flatMap((item) => {
    if (item.kind === 'artifact') {
      return [{ blob: item.blob, path: item.materialiseAs }];
    }
    if (item.kind === 'order' && item.field === 'body') {
      return [{ blob: item.blob, path: item.materialiseAs }];
    }
    return [];
  });
  const sizes = new Map<BlobRef, number>();
  for (const [ref, size] of await ports.blobs.stat(inputs.map((i) => i.blob))) {
    sizes.set(ref, size);
  }
  const feedbackRefs: BlobRef[] = [];
  if (context.feedback?.kind === 'verdict') {
    feedbackRefs.push(context.feedback.blob);
  }
  if (context.feedback?.kind === 'inspection') {
    feedbackRefs.push(...context.feedback.logBlobs);
  }
  const texts = new Map<BlobRef, string>();
  for (const ref of [state.spec.bodyBlob, ...feedbackRefs]) {
    texts.set(ref, await textOf(ports.blobs, ref));
  }

  const text = buildPrompt({
    profile,
    templates: ports.definitions.templates,
    todoId: state.todoId,
    cycleId: active.cycleId ?? stationCycleMissing(),
    todoBody: texts.get(state.spec.bodyBlob) ?? '',
    context,
    blobSizes: sizes,
    blobTexts: texts,
    budget: {
      retry: state.retriesUsed[stationId] ?? 0,
      max: station.onFail?.max ?? 0,
    },
    declared: { rules: profile.rules, skills: profile.skills },
    operatorCommands: ports.config.operatorCommands,
    logTailChars: ports.config.logTailChars,
  });
  const promptBlob = await storeText(ports.blobs, text, 'text/markdown');

  return jobSchema.parse({
    ...common,
    kind: 'run_operator_station',
    base,
    station: {
      ...stationBase,
      operator: {
        profile: pool.profile,
        runner: pool.runner,
        model: pool.model,
        permission: pool.permission,
        headless: pool.headless,
        timeoutMs: pool.timeoutMs,
      },
      promptBlob,
      inputs,
      outputs: context.outputs.map((output) => ({
        key: output.key,
        path: output.path,
        // A verdict writes its feedback only when it fails: the domain refuses a failing verdict without it,
        // so a passing verdict must not be refused for a feedback file it has no reason to write.
        required: !(
          output.key === 'feedback' &&
          (station.verdict ?? profile.verdict)
        ),
      })),
      verdict: station.verdict ?? profile.verdict,
      runtimePrompts: ports.definitions.runtimePrompts,
    },
  });
};

/** What `buildPlanJob` needs of a claimed plan: the claim's identity, the plan row and its members. */
export interface PlanJobInput {
  jobId: JobId;
  epoch: number;
  kind: PlanJobKind;
  plan: PlanProjection;
  project: ProjectRecord;
  rows: readonly OrderProjection[];
}

/** The sub-PR list of a plan PR body: one line per member, in chain order, with its PR when it has one. */
export const renderPlanBody = (
  plan: PlanProjection,
  rows: readonly OrderProjection[],
): string => {
  const lines = plan.members.map((member) => {
    const row = rows.find((candidate) => candidate.orderId === member.orderId);
    const title = row?.title ?? member.todoId;
    const link = row?.prUrl ? ` ${row.prUrl}` : ' (no PR yet)';
    return `- ${member.todoId}: ${title}${link}`;
  });
  return [
    `## Order Plan ${plan.slug}`,
    '',
    'Sub-PRs, in chain order:',
    '',
    ...lines,
    '',
  ].join('\n');
};

/**
 * The Job a claimed plan job becomes (PROTOCOL §4). A plan job runs on the bare mirror only, so it has no
 * workspace and no station. `plan_pr` and `plan_pr_ready` carry the sub-PR list as a blob; `plan_pr_ready`
 * names the plan PR it marks ready. Pure apart from the one body blob write.
 */
export const buildPlanJob = async (
  blobs: BlobStore,
  input: PlanJobInput,
): Promise<Job> => {
  const { plan } = input;
  const bodyBlob =
    input.kind === 'plan_branch'
      ? undefined
      : await storeText(
          blobs,
          renderPlanBody(plan, input.rows),
          'text/markdown',
        );
  if (input.kind === 'plan_pr_ready' && plan.prUrl === null) {
    throw refusal({
      code: 'precondition',
      detail: `plan ${plan.slug} has no plan PR to mark ready`,
    });
  }
  return jobSchema.parse({
    jobId: input.jobId,
    orderId: plan.planId,
    projectId: plan.projectId,
    epoch: input.epoch,
    kind: input.kind,
    repo: {
      url: input.project.repoUrl,
      baseBranch: plan.baseBranch,
      branch: plan.branch,
    },
    base: { branchBase: plan.baseBranch },
    plan: {
      slug: plan.slug,
      title: `Order Plan ${plan.slug}`,
      ...(bodyBlob === undefined ? {} : { bodyBlob }),
      ...(input.kind === 'plan_pr_ready' && plan.prUrl !== null
        ? { prUrl: plan.prUrl }
        : {}),
    },
  });
};

/** A claimed job always carries its Cycle id; a missing one is a bug in the claim, not a refusal. */
const stationCycleMissing = (): never => {
  throw new Error('a claimed job has no cycle id');
};

/**
 * The deliver commit: one `type(scope): title` subject, a blank line and a `- ` change list, the shape the
 * repository's commit-message rule (rich-commit) accepts. The todo id prefix of the title is not repeated.
 */
export const richCommitOf = (
  type: string,
  title: string,
  todoId: string,
): string => {
  const plain = title.startsWith(`${todoId}:`)
    ? title.slice(todoId.length + 1).trim()
    : title.trim();
  const subject = `${type}(factory): ${plain}`;
  const short = subject.length > 72 ? `${subject.slice(0, 69)}...` : subject;
  return `${short}\n\n- Deliver the Work order for todo ${todoId}\n`;
};
