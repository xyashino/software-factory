import type { z } from 'zod';
import { startHeartbeat } from '../../../cell/heartbeat';
import {
  HEARTBEAT_INTERVAL_MS,
  LINES_DIR,
  WORKTREES_DIR,
} from '../../../config';
import { heartbeatCellContract } from '../../../contracts/cells.contract';
import { slugSchema } from '../../../contracts/common';
import { transitionJobContract } from '../../../contracts/jobs.contract';
import { operatorRequest } from '../../../contracts/operator.contract';
import { commandIdOf } from '../../../domain/cell/command-id';
import type { OperatorOutcome } from '../../../domain/cell/cell-loop';
import { toJobId } from '../../../domain/common/brand';
import { joinPath } from '../../../domain/common/path';
import { factoryBranchOf, slugOf } from '../../../domain/git/branch-names';
import { parseLine, type LineSnapshot } from '../../../domain/line/parse-line';
import {
  type CellRuntime,
  type ClaimedJob,
  sendWithRetry,
} from './cell-runtime';
import { checkpointStation } from './checkpoint.procedure';
import { deliverWorkOrder } from './deliver.procedure';

const HEARTBEATS_ROUTE = '/api/v1/cells/heartbeats';
const LINE_SUFFIX = '.yml';
const CYCLE_TOKEN_BYTES = 16;
const UNKNOWN_LINE = 'unknown';
const FAILED_VERDICT_DETAIL = 'verdict fail';
const PROMPT_FILE = 'prompt.md';
const STEP_LOG = 'step.log';
const CELL_DIR = '.cell';
const CELL_EXCLUDE = `${CELL_DIR}/`;
const WORKTREE_FILE = 'worktree.json';
const WORKTREE_JSON_INDENT = 2;

type TransitionCommand = z.infer<typeof transitionJobContract.in.body>;
type TransitionBody<C> = C extends unknown
  ? Omit<C, 'commandId' | 'epoch'>
  : never;
type TransitionReply = z.infer<(typeof transitionJobContract.out)[200]>;
type StepLine = LineSnapshot['stations'][number];

type RunEnd =
  | { kind: 'operator'; outcome: OperatorOutcome }
  | { kind: 'exited'; exitCode: number }
  | { kind: 'aborted' };

interface Launch {
  command: string;
  args: string[];
  logPath: string;
}

type LaunchPlan =
  { kind: 'ok'; launch: Launch } | { kind: 'unavailable'; detail: string };

type LineLoad =
  | { kind: 'ok'; snapshot: LineSnapshot; station: StepLine | undefined }
  | { kind: 'unavailable'; lineName: string; detail: string };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const cycleTokenOf = (): string =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(CYCLE_TOKEN_BYTES)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const worktreeOf = (runtime: CellRuntime, job: ClaimedJob): string =>
  joinPath(runtime.repoRoot, WORKTREES_DIR, slugOf(job.orderId));

const nextJobOf = (reply: TransitionReply): ClaimedJob | null =>
  'nextJob' in reply ? reply.nextJob : null;

const transition = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  body: TransitionBody<TransitionCommand>,
): Promise<TransitionReply> => {
  const commandId = commandIdOf({
    cellId: runtime.session.cellId,
    orderId: job.orderId ?? job.jobId,
    epoch: job.epoch,
    command: body.action,
  });
  return sendWithRetry(runtime, async () =>
    transitionJobContract.out[200].parse(
      await runtime.ports.server.call(
        `/api/v1/jobs/${encodeURIComponent(job.jobId)}/transitions`,
        { ...body, commandId, epoch: job.epoch },
        runtime.session.sessionToken,
      ),
    ),
  );
};

const lineNameOf = (job: ClaimedJob): string | undefined => {
  const name = job.payload.lineName;
  return typeof name === 'string' ? name : undefined;
};

const loadLine = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<LineLoad> => {
  const lineName = lineNameOf(job);
  const slug = slugSchema.safeParse(lineName);
  if (lineName === undefined || !slug.success) {
    return {
      kind: 'unavailable',
      lineName: UNKNOWN_LINE,
      detail: 'job names no valid line',
    };
  }
  const path = joinPath(
    runtime.repoRoot,
    LINES_DIR,
    `${slug.data}${LINE_SUFFIX}`,
  );
  try {
    if (!(await runtime.ports.fs.exists(path))) {
      return {
        kind: 'unavailable',
        lineName: slug.data,
        detail: `line file missing: ${path}`,
      };
    }
    const snapshot = parseLine(await runtime.ports.fs.readText(path));
    const stepIndex = job.expectedPriorSteps.length;
    return { kind: 'ok', snapshot, station: snapshot.stations[stepIndex] };
  } catch (error) {
    return {
      kind: 'unavailable',
      lineName: slug.data,
      detail: `line file invalid: ${errorText(error)}`,
    };
  }
};

const missingPriorFiles = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<{ stepId: string; files: string[] } | null> => {
  const [firstPrior] = job.expectedPriorSteps;
  if (firstPrior === undefined) {
    return null;
  }
  const dir = worktreeOf(runtime, job);
  const missing: string[] = [];
  let missingStepId: string | undefined;
  if (
    !(await runtime.ports.fs.exists(joinPath(dir, '.cell', 'worktree.json')))
  ) {
    missing.push('.cell/worktree.json');
  }
  for (const prior of job.expectedPriorSteps) {
    const file = `.cell/${prior.stepId}/state.json`;
    if (!(await runtime.ports.fs.exists(joinPath(dir, file)))) {
      missing.push(file);
      missingStepId ??= prior.stepId;
    }
  }
  return missing.length === 0
    ? null
    : { stepId: missingStepId ?? firstPrior.stepId, files: missing };
};

const missingRequiredFiles = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
): Promise<string[]> => {
  const stepId = job.stepId ?? station?.stationId;
  if (stepId === undefined || station === undefined) {
    return [];
  }
  const dir = joinPath(worktreeOf(runtime, job), '.cell', stepId);
  const missing: string[] = [];
  for (const file of station.requiredFiles) {
    if (!(await runtime.ports.fs.exists(joinPath(dir, file)))) {
      missing.push(file);
    }
  }
  return missing;
};

const lineUnavailable = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  lineName: string,
  detail: string,
): Promise<ClaimedJob | null> =>
  nextJobOf(
    await transition(runtime, job, {
      action: 'line_unavailable',
      lineName,
      detail,
    }),
  );

const launchOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
): Promise<LaunchPlan> => {
  const runner = station?.runner ?? null;
  if (station === undefined || runner === null) {
    return { kind: 'unavailable', detail: 'station names no runner' };
  }
  const { runners } = runtime.ports;
  if (!(await runners.isInstalled(runner))) {
    return { kind: 'unavailable', detail: `runner not installed: ${runner}` };
  }
  const stepId = job.stepId ?? station.stationId;
  const commandLine = runners.commandLine(
    runner,
    joinPath('.cell', stepId, PROMPT_FILE),
  );
  if (commandLine === undefined) {
    return { kind: 'unavailable', detail: `no runner adapter: ${runner}` };
  }
  return {
    kind: 'ok',
    launch: {
      command: commandLine.command,
      args: commandLine.args,
      logPath: joinPath(worktreeOf(runtime, job), '.cell', stepId, STEP_LOG),
    },
  };
};

const outcomeOf = (
  verb: z.infer<typeof operatorRequest>,
): OperatorOutcome | null => {
  if (verb.verb === 'done') {
    return { kind: 'done' };
  }
  if (verb.verb === 'verdict') {
    return verb.outcome === 'pass'
      ? { kind: 'verdict', outcome: 'pass' }
      : {
          kind: 'verdict',
          outcome: 'fail',
          feedback: verb.feedback ?? FAILED_VERDICT_DETAIL,
        };
  }
  if (verb.verb === 'block') {
    return { kind: 'block', reason: verb.reason, handover: verb.handover };
  }
  return null;
};

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const operatorHandler =
  (cycleToken: string, end: Deferred<RunEnd>) =>
  async (request: unknown): Promise<unknown> => {
    const parsed = operatorRequest.safeParse(request);
    if (!parsed.success) {
      return { code: 400, type: 'invalid', message: 'unknown operator verb' };
    }
    if (parsed.data.token !== cycleToken) {
      return { code: 401, type: 'unauthorized', message: 'bad cycle token' };
    }
    const outcome = outcomeOf(parsed.data);
    if (outcome === null) {
      return {
        code: 400,
        type: 'invalid',
        message: `verb ${parsed.data.verb} is not served by the cell loop`,
      };
    }
    end.resolve({ kind: 'operator', outcome });
    return { code: 200 };
  };

const finishWithFail = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  detail: string,
): Promise<ClaimedJob | null> =>
  nextJobOf(await transition(runtime, job, { action: 'fail', detail }));

const finishComplete = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
): Promise<ClaimedJob | null> => {
  const missing = await missingRequiredFiles(runtime, job, station);
  if (missing.length > 0) {
    return finishWithFail(
      runtime,
      job,
      `missing required files: ${missing.join(', ')}`,
    );
  }
  const produced = station?.requiredFiles ?? [];
  let commitSha: string | undefined;
  try {
    commitSha = await checkpointStation(runtime.ports, {
      worktree: worktreeOf(runtime, job),
      slug: slugOf(job.orderId),
      stepId: job.stepId ?? station?.stationId ?? '',
      producedFiles: produced,
    });
  } catch (error) {
    return finishWithFail(
      runtime,
      job,
      `checkpoint failed: ${errorText(error)}`,
    );
  }
  return nextJobOf(
    await transition(runtime, job, {
      action: 'complete',
      producedFiles: produced,
      commitSha,
    }),
  );
};

const finish = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  end: RunEnd,
): Promise<ClaimedJob | null> => {
  switch (end.kind) {
    case 'aborted':
      return null;
    case 'exited':
      return finishWithFail(
        runtime,
        job,
        `runner exited with code ${end.exitCode} before a verdict`,
      );
    case 'operator':
      return finishOperator(runtime, job, station, end.outcome);
  }
};

const finishOperator = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  outcome: OperatorOutcome,
): Promise<ClaimedJob | null> => {
  switch (outcome.kind) {
    case 'done':
      return finishComplete(runtime, job, station);
    case 'verdict':
      return outcome.outcome === 'pass'
        ? finishComplete(runtime, job, station)
        : finishWithFail(runtime, job, outcome.feedback);
    case 'block':
      return nextJobOf(
        await transition(runtime, job, {
          action: 'block',
          detail: outcome.reason,
        }),
      );
  }
};

const worktreeMissingOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  missing: { stepId: string; files: string[] },
): Promise<ClaimedJob | null> =>
  nextJobOf(
    await transition(runtime, job, {
      action: 'worktree_missing',
      missingStepId: missing.stepId,
      missingFiles: missing.files,
    }),
  );

const prepareWorktree = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  lineName: string,
): Promise<string | null> => {
  const { git, fs } = runtime.ports;
  const worktree = worktreeOf(runtime, job);
  const slug = slugOf(job.orderId);
  try {
    if (!(await fs.exists(worktree))) {
      await git.worktreeAdd(
        runtime.repoRoot,
        worktree,
        factoryBranchOf(slug),
        job.baseBranch,
      );
    }
    await git.excludeLocally(worktree, CELL_EXCLUDE);
    const record = {
      projectId: runtime.projectId,
      orderId: job.orderId,
      planId: job.planId,
      lineName,
      baseBranch: job.baseBranch,
      baseCommitSha: job.baseCommitSha,
      cellId: runtime.session.cellId,
    };
    await fs.writeText(
      joinPath(worktree, CELL_DIR, WORKTREE_FILE),
      `${JSON.stringify(record, null, WORKTREE_JSON_INDENT)}\n`,
    );
    return null;
  } catch (error) {
    return `workspace failed: ${errorText(error)}`;
  }
};

const deliverStation = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
): Promise<ClaimedJob | null> => {
  const missing = await missingPriorFiles(runtime, job);
  if (missing !== null) {
    return worktreeMissingOf(runtime, job, missing);
  }
  await transition(runtime, job, { action: 'start', lineSnapshot: snapshot });
  try {
    const commitSha = await deliverWorkOrder(runtime.ports, {
      repoRoot: runtime.repoRoot,
      worktree: worktreeOf(runtime, job),
      slug: slugOf(job.orderId),
      baseBranch: job.baseBranch,
      priorStepIds: job.expectedPriorSteps.map((step) => step.stepId),
    });
    return nextJobOf(
      await transition(runtime, job, {
        action: 'complete',
        producedFiles: [],
        commitSha,
      }),
    );
  } catch (error) {
    return finishWithFail(runtime, job, `delivery failed: ${errorText(error)}`);
  }
};

const execute = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  launch: Launch,
): Promise<ClaimedJob | null> => {
  const { ports } = runtime;
  const cycleToken = cycleTokenOf();
  const end = deferred<RunEnd>();
  const endpoint = await ports.operator.open(
    toJobId(job.jobId),
    operatorHandler(cycleToken, end),
  );
  const handle = await ports.runner.start({
    ...launch,
    cwd: worktreeOf(runtime, job),
    env: {
      FACTORY_OPERATOR_URL: endpoint.url,
      FACTORY_CYCLE_TOKEN: cycleToken,
    },
  });
  const heartbeat = startHeartbeat({
    clock: ports.clock,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    beat: async () =>
      heartbeatCellContract.out[200].parse(
        await ports.server.call(
          HEARTBEATS_ROUTE,
          { jobId: job.jobId, epoch: job.epoch },
          runtime.session.sessionToken,
        ),
      ).signals,
    onAbort: () => {
      end.resolve({ kind: 'aborted' });
      void ports.runner.abort(handle);
    },
  });
  void ports.runner.wait(handle).then(
    (outcome) => end.resolve({ kind: 'exited', exitCode: outcome.exitCode }),
    () => end.resolve({ kind: 'exited', exitCode: -1 }),
  );
  try {
    return await finish(runtime, job, station, await end.promise);
  } finally {
    heartbeat.stop();
    await ports.operator.close();
  }
};

export const runJob = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<ClaimedJob | null> => {
  const line = await loadLine(runtime, job);
  if (line.kind === 'unavailable') {
    return lineUnavailable(runtime, job, line.lineName, line.detail);
  }
  if (line.station?.kind === 'deliver') {
    return deliverStation(runtime, job, line.snapshot);
  }
  const plan = await launchOf(runtime, job, line.station);
  if (plan.kind === 'unavailable') {
    return lineUnavailable(runtime, job, line.snapshot.name, plan.detail);
  }
  const missing = await missingPriorFiles(runtime, job);
  if (missing !== null) {
    return worktreeMissingOf(runtime, job, missing);
  }
  await transition(runtime, job, {
    action: 'start',
    lineSnapshot: line.snapshot,
  });
  if (job.expectedPriorSteps.length === 0) {
    const failure = await prepareWorktree(runtime, job, line.snapshot.name);
    if (failure !== null) {
      return finishWithFail(runtime, job, failure);
    }
  }
  return execute(runtime, job, line.station, plan.launch);
};
