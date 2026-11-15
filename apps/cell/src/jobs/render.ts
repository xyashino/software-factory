import type { Job } from '@repo/factory-core/contracts/job';
import type { BlobRef } from '@repo/factory-core/ids';
import type { CycleContext } from '@repo/factory-core/order/context';
import type { DefinitionError } from '@repo/factory-definitions/errors';
import {
  loadRepoDefinitions,
  type Definitions,
} from '@repo/factory-definitions/load';
import { richCommitOf } from '@repo/factory-runtime/job-builder';
import { DEFAULT_CONFIG } from '@repo/factory-runtime/ports';
import {
  commitTitle,
  formatPrBody,
  usableCommitMessage,
  verificationLinesOf,
} from '@repo/factory-runtime/pr-body';
import { buildIncidentPrompt } from '@repo/factory-runtime/prompts/incident-prompt';
import {
  buildPrompt,
  type DeclaredUnit,
} from '@repo/factory-runtime/prompts/build-prompt';

/**
 * Prompt and PR rendering on the Cell (PROTOCOL §4, §9). The server sends structured inputs and blob refs; the
 * Cell reads the repo's own `.factory/` from the worktree and renders the Operator prompt, the Mechanic prompt and
 * the PR body. A repo whose `.factory/` cannot render the job fails that job with a diagnostic; nothing is guessed.
 */

const decoder = new TextDecoder();

/** The prompt settings this Cell renders with: the runtime's defaults for the operator CLI. */
export const PROMPT_CONFIG: PromptConfig = {
  operatorCommands: DEFAULT_CONFIG.operatorCommands,
};

/** A job that cannot be rendered from its repo's `.factory/`: it fails with this message, and nothing runs. */
export class RenderFailed extends Error {}

/** Reads a blob's bytes by ref: the Cell's blob download. */
export type BlobReader = (ref: BlobRef) => Promise<Uint8Array>;

/** The delivery block of a deliver job. */
export type Delivery = NonNullable<Job['deliver']>;

/** The Operator prompt inputs the Cell renders from: its own CLI commands, not the server's. */
export interface PromptConfig {
  operatorCommands: string[];
}

/** A delivery's rendered commit message, PR title and PR body (the ADR token still in the body). */
export interface RenderedDelivery {
  commitMessage: string;
  title: string;
  body: string;
}

const diagnosisOf = (error: DefinitionError): string =>
  `${error.file} ${error.field}: ${error.message}`;

/** The repo's definitions as its worktree holds them: `.factory/` validated, `.nitpick/` checked when present. */
const repoDefinitions = async (worktree: string): Promise<Definitions> => {
  const loaded = await loadRepoDefinitions(worktree);
  if (!loaded.ok) {
    throw new RenderFailed(
      `invalid .factory/ in ${worktree}: ${loaded.error.map(diagnosisOf).join('; ')}`,
    );
  }
  return loaded.value;
};

const textOf = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Declared ids with their repo-relative paths where the repo's `.nitpick/` catalog resolves them. */
const declaredUnits = (
  ids: string[],
  paths: ReadonlyMap<string, string>,
): DeclaredUnit[] =>
  ids.map((id) => {
    const path = paths.get(id);
    return path === undefined ? { id } : { id, path };
  });

/** Every blob the prompt of a Cycle names: the spec body, the inputs, the verdict and the inspection logs. */
const promptBlobsOf = (todoBody: BlobRef, context: CycleContext): BlobRef[] => {
  const refs: BlobRef[] = [todoBody];
  for (const item of context.inputs) {
    if (item.kind === 'artifact') refs.push(item.blob);
    if (item.kind === 'order' && item.field === 'body') refs.push(item.blob);
  }
  if (context.feedback?.kind === 'verdict') refs.push(context.feedback.blob);
  if (context.feedback?.kind === 'inspection') {
    refs.push(...context.feedback.logBlobs);
    refs.push(...context.feedback.results.map((result) => result.logBlob));
  }
  return [...new Set(refs)];
};

/** The Operator prompt of a station job, built from the repo's profile and templates (CORE §7, PROTOCOL §4). */
export const renderOperatorPrompt = async (input: {
  job: Job;
  worktree: string;
  blobs: BlobReader;
  config: PromptConfig;
}): Promise<string> => {
  const station = input.job.station;
  if (
    station?.operator === undefined ||
    station.prompt === undefined ||
    station.cycleId === undefined
  ) {
    throw new RenderFailed(`job ${input.job.jobId} names no prompt inputs`);
  }
  const definitions = await repoDefinitions(input.worktree);
  const profile = definitions.operators.get(station.operator.profile);
  if (profile === undefined) {
    throw new RenderFailed(
      `operator profile ${station.operator.profile} is not in ${input.worktree}/.factory/operators`,
    );
  }
  const { prompt } = station;
  const bytes = new Map<BlobRef, Uint8Array>();
  for (const ref of promptBlobsOf(prompt.todoBodyBlob, prompt.context)) {
    bytes.set(ref, await input.blobs(ref));
  }
  const texts = new Map([...bytes].map(([ref, data]) => [ref, textOf(data)]));
  const sizes = new Map(
    [...bytes].map(([ref, data]) => [ref, data.byteLength]),
  );
  try {
    return buildPrompt({
      profile,
      templates: definitions.templates,
      todoId: prompt.taskId,
      cycleId: station.cycleId,
      todoBody: texts.get(prompt.todoBodyBlob) ?? '',
      context: prompt.context,
      blobSizes: sizes,
      blobTexts: texts,
      budget: prompt.budget,
      declared: {
        rules: declaredUnits(profile.rules, definitions.rulePaths),
        skills: declaredUnits(profile.skills, definitions.skillPaths),
      },
      operatorCommands: input.config.operatorCommands,
    });
  } catch (error) {
    throw new RenderFailed(
      `the prompt of ${profile.id} cannot be built from ${input.worktree}/.factory: ${(error as Error).message}`,
    );
  }
};

/** The Mechanic's prompt for the Andon it triages (CORE §14.4). The incident template ships with the Cell. */
export const renderIncidentPrompt = (incident: {
  reason: string;
  detail: string;
}): string => buildIncidentPrompt(incident);

/**
 * A delivery's commit message, PR title and PR body (v1 PR format). The commit is the builder's own commit artifact
 * when it is usable, else the rich commit built from the spec; the body comes from the repo's `pr/body` template.
 */
export const renderDelivery = async (input: {
  deliver: Delivery;
  worktree: string;
  blobs: BlobReader;
}): Promise<RenderedDelivery> => {
  const { deliver } = input;
  const definitions = await repoDefinitions(input.worktree);
  const textFor = async (
    ref: BlobRef | undefined,
  ): Promise<string | undefined> =>
    ref === undefined ? undefined : textOf(await input.blobs(ref));
  const commitMessage =
    usableCommitMessage(await textFor(deliver.commitBlob)) ??
    richCommitOf(deliver.type, deliver.title, deliver.taskId);
  const report = await textFor(deliver.reportBlob);
  try {
    const body = formatPrBody(
      {
        taskId: deliver.taskId,
        type: deliver.type,
        todoBody: (await textFor(deliver.todoBodyBlob)) ?? '',
        commitMessage,
        ...(report === undefined ? {} : { report }),
        logCommand: deliver.logCommand,
        verification: verificationLinesOf(deliver.verification),
      },
      definitions.prTemplates,
    );
    return { commitMessage, title: commitTitle(commitMessage), body };
  } catch (error) {
    throw new RenderFailed(
      `the PR body cannot be built from ${input.worktree}/.factory/templates/pr: ${(error as Error).message}`,
    );
  }
};
