import { createHash } from 'node:crypto';
import { jobSchema, type Job } from '@repo/factory-core/contracts/job';
import type { BlobRef, CommitSha, JobId } from '@repo/factory-core/ids';
import type { PlanJobKind } from '@repo/factory-core/plan/events';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import {
  findStation,
  type LineSnapshot,
  type Station,
} from '@repo/factory-core/line/snapshot';
import { resolveCycleContext } from '@repo/factory-core/order/context';
import type { JobSpec } from '@repo/factory-core/order/next';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { planBranchOf } from '@repo/factory-core/ids';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { BlobStore } from '@repo/factory-core/ports/blob-store';
import type { ArtifactRef } from '@repo/factory-definitions/line-schema';
import type { RuntimePrompts } from '@repo/factory-definitions/templates';
import { refusal } from './errors';
import { artifactBlob } from './pr-body';
import type { RuntimeConfig } from './ports';

/**
 * What the builder reads: the blobs a job refers to, the protocol's runtime prompts (`templates/runtime/`, shipped
 * with the package) and the runtime config. It reads no repo definition: the Line a Work order runs is the pinned
 * snapshot, and the repo's own templates, operators and PR body are the Cell's to read from `.factory/`.
 */
export interface JobPorts {
  blobs: BlobStore;
  runtimePrompts: RuntimePrompts;
  config: RuntimeConfig;
}

/** The `sha256:<hex>` ref of text, stored as a blob. A text is stored once, however often it is written. */
export const storeText = async (
  blobs: BlobStore,
  text: string,
  mediaType: string,
): Promise<BlobRef> => {
  const bytes = new TextEncoder().encode(text);
  const ref =
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
  await blobs.put(ref, bytes, mediaType);
  return ref;
};

const baseOf = (
  base: CommitSha | 'branch_base',
  branchBase: string,
): CommitSha | { branchBase: string } =>
  base === 'branch_base' ? { branchBase } : base;

/** A pinned Line from before job details were carried: the Work order cannot run, and nothing is guessed. */
const unpinned = (detail: string) =>
  refusal({
    code: 'precondition',
    detail: `${detail}; the Work order was pinned before job details were carried, so recreate it`,
  });

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

/** The workspace preparation of the pinned Line: its sync and setup commands, and the setup timeout. */
const workspaceOf = (line: LineSnapshot) => {
  const setup = line.workspace?.setup;
  if (setup === undefined) {
    throw unpinned(`line ${line.name} names no workspace setup`);
  }
  return {
    sync: line.workspace?.sync?.exec ?? [],
    setup: setup.exec,
    timeoutMs: setup.timeoutMs,
  };
};

/** The Operator pool a station runs with, as the snapshot pinned it. */
const poolOf = (station: Station) => {
  if (station.operator === undefined) {
    throw unpinned(`station ${station.id} carries no operator pool`);
  }
  return station.operator;
};

/** The artifacts a delivery commits and reports, from the pinned `deliver` block (`<stationId>.<key>`). */
const deliverRefsOf = (
  line: LineSnapshot,
): { commit: ArtifactRef; report: ArtifactRef } => {
  const deliver = line.deliver;
  if (deliver === undefined) {
    throw unpinned(`line ${line.name} names no delivery artifacts`);
  }
  return {
    commit: artifactRefOf(deliver.commit),
    report: artifactRefOf(deliver.report),
  };
};

/** `<stationId>.<artifactKey>` as an artifact reference: the station id is everything before the first dot. */
const artifactRefOf = (text: string): ArtifactRef => {
  const dot = text.indexOf('.');
  return { stationId: text.slice(0, dot), artifactKey: text.slice(dot + 1) };
};

/** The checklist of a PR body: one entry per Inspection (its commands) and per Operator station (its profile). */
const verificationOf = (line: LineSnapshot) =>
  line.stations.map((station) =>
    station.kind === 'inspection'
      ? {
          kind: 'inspection' as const,
          stationId: station.id,
          commands: station.exec ?? [],
        }
      : {
          kind: 'operator' as const,
          stationId: station.id,
          profile: poolOf(station).profile,
        },
  );

/**
 * The Job a claimed job becomes (PROTOCOL §4). `spec` is the job `nextJob` named before the claim, `state` the
 * state after it. Every path is relative; every text is a blob ref, so the Cell reads the spec, the artifacts and
 * the logs itself. Pure apart from the one prompt-independent read of the delivery artifacts.
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
  const line = state.line;
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
    workspace: { dir: state.todoId, ...workspaceOf(line) },
  };

  if (next.job.kind === 'deliver') {
    const refs = deliverRefsOf(line);
    const commitBlob = artifactBlob(state, refs.commit);
    const reportBlob = artifactBlob(state, refs.report);
    return jobSchema.parse({
      ...common,
      kind: 'deliver',
      base: next.job.base,
      deliver: {
        taskId: state.todoId,
        type: state.spec.type,
        title: state.spec.title,
        todoBodyBlob: state.spec.bodyBlob,
        ...(commitBlob === undefined ? {} : { commitBlob }),
        ...(reportBlob === undefined ? {} : { reportBlob }),
        logCommand: `factory log ${state.orderId}`,
        verification: verificationOf(line),
      },
    });
  }

  if (next.job.kind === 'mechanic') {
    // The Mechanic runs in the repair checkout, not in a worktree: no workspace (CORE §14.4).
    const andon = state.andon;
    if (!andon || andon.at !== next.job.andonAt) {
      throw refusal({
        code: 'precondition',
        detail: 'the mechanic job names no open Andon',
      });
    }
    // The Mechanic runs with the Line's first Operator pool (CORE §14.4).
    const station = line.stations.find((candidate) => candidate.operator);
    if (!station?.operator) {
      throw refusal({
        code: 'precondition',
        detail: 'the Line names no operator for the mechanic',
      });
    }
    return jobSchema.parse({
      jobId: active.jobId,
      orderId: state.orderId,
      projectId: state.projectId,
      epoch: active.epoch,
      kind: 'mechanic',
      repo: common.repo,
      base: { branchBase },
      mechanic: {
        andonAt: next.job.andonAt,
        n: next.job.n,
        incident: { reason: andon.reason, detail: andon.detail },
        // A Mechanic always runs in a Herdr pane (PROTOCOL §9), whatever the pool says.
        operator: { ...station.operator, headless: false },
      },
    });
  }

  const { stationId, n, cause } = next.job;
  const station = findStation(line, stationId);
  if (!station) {
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
    if (station.kind !== 'inspection') {
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
          station.timeoutMs || ports.config.inspectionTimeoutMs,
      },
    });
  }

  if (station.kind !== 'operator') {
    throw refusal({
      code: 'precondition',
      detail: `station ${stationId} is not an operator station`,
    });
  }
  const pool = poolOf(station);
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
  const verdict = station.verdict ?? false;

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
      prompt: {
        taskId: state.todoId,
        todoBodyBlob: state.spec.bodyBlob,
        context,
        budget: {
          retry: state.retriesUsed[stationId] ?? 0,
          max: station.onFail?.max ?? 0,
        },
      },
      inputs,
      outputs: context.outputs.map((output) => ({
        key: output.key,
        path: output.path,
        // A verdict writes its feedback only when it fails: the domain refuses a failing verdict without it,
        // so a passing verdict must not be refused for a feedback file it has no reason to write.
        required: !(output.key === 'feedback' && verdict),
      })),
      verdict,
      runtimePrompts: ports.runtimePrompts,
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
