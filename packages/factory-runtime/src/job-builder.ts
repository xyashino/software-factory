import { createHash } from 'node:crypto';
import { jobSchema, type Job } from '@repo/factory-core/contracts/job';
import type { BlobRef, CommitSha } from '@repo/factory-core/ids';
import { findStation } from '@repo/factory-core/line/snapshot';
import { resolveCycleContext } from '@repo/factory-core/order/context';
import type { JobSpec } from '@repo/factory-core/order/next';
import type { WorkOrderState } from '@repo/factory-core/order/state';
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
  project: ProjectRecord,
): CommitSha | { branchBase: string } =>
  base === 'branch_base' ? { branchBase: project.baseBranch } : base;

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
): Promise<Job> => {
  const active = state.activeJob;
  if (!active) {
    throw refusal({ code: 'precondition', detail: 'no job is active' });
  }
  const next: { kind: 'job'; job: JobSpec } = { kind: 'job', job: spec };
  const line = lineOf(ports.definitions, state.line.name);
  const common = {
    jobId: active.jobId,
    orderId: state.orderId,
    projectId: state.projectId,
    epoch: active.epoch,
    repo: {
      url: project.repoUrl,
      baseBranch: project.baseBranch,
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
        commitMessage: state.spec.title,
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
  const base = baseOf(next.job.base, project);
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
        required: true,
      })),
      verdict: station.verdict ?? profile.verdict,
      runtimePrompts: ports.definitions.runtimePrompts,
    },
  });
};

/** A claimed job always carries its Cycle id; a missing one is a bug in the claim, not a refusal. */
const stationCycleMissing = (): never => {
  throw new Error('a claimed job has no cycle id');
};
