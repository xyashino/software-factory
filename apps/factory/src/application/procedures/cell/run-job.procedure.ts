import type { z } from 'zod';
import { startHeartbeat } from '../../../cell/heartbeat';
import { observeDrain } from '../../../cell/drain-signal';
import {
  HEARTBEAT_INTERVAL_MS,
  LINES_DIR,
  OPERATORS_DIR,
  WORKTREES_DIR,
  operatorCommandOf,
} from '../../../config';
import {
  heartbeatCellContract,
  stepPayloadSchema,
} from '../../../contracts/cells.contract';
import { slugSchema } from '../../../contracts/common';
import { transitionJobContract } from '../../../contracts/jobs.contract';
import { operatorRequest } from '../../../contracts/operator.contract';
import { commandIdOf } from '../../../domain/cell/command-id';
import { renderLogLine } from '../../../domain/cell/log-line';
import type { OperatorOutcome } from '../../../domain/cell/cell-loop';
import { drainPolicy } from '../../../domain/cell/drain-policy';
import { toJobId } from '../../../domain/common/brand';
import { joinPath } from '../../../domain/common/path';
import { factoryBranchOf, slugOf } from '../../../domain/git/branch-names';
import {
  profileArtifacts,
  renderOperatorPrompt,
} from '../../../domain/line/operator-prompt';
import {
  parseLine,
  wireSnapshotOf,
  type LineSnapshot,
} from '../../../domain/line/parse-line';
import {
  type CellRuntime,
  type ClaimedJob,
  sendWithRetry,
} from './cell-runtime';
import { checkpointStation } from './checkpoint.procedure';
import { deliverWorkOrder } from './deliver.procedure';
import { leaveCell } from './leave.procedure';

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
const STATE_FILE = 'state.json';
const TASK_FILE = 'task.md';
const EVIDENCE_DIR = 'evidence';
const PROFILE_SUFFIX = '.md';
const SHELL = 'bash';
const OUTPUT_TAIL_CHARS = 2000;
const SETUP_LOG = 'setup.log';
const FEEDBACK_FILE = 'feedback.md';
const RUNNER_FILE = 'runner.json';
const DECISIONS_DIR = 'decisions/';
const MAX_DIFF_CHARS = 60_000;
const MS_PER_MINUTE = 60_000;
// The station a claimed job runs, for log lines; set once its line is loaded.
const stationNames = new WeakMap<ClaimedJob, string>();

type TransitionCommand = z.infer<typeof transitionJobContract.in.body>;
type TransitionBody<C> = C extends unknown
  ? Omit<C, 'commandId' | 'epoch'>
  : never;
type TransitionReply = z.infer<(typeof transitionJobContract.out)[200]>;
type StepLine = LineSnapshot['stations'][number];

type RunEnd =
  | { kind: 'operator'; outcome: OperatorOutcome }
  | { kind: 'exited'; exitCode: number }
  | { kind: 'aborted' }
  | { kind: 'timeout' }
  | { kind: 'drain-force' };

interface Launch {
  command: string;
  args: string[];
  logPath: string;
  interactive: boolean;
}

type LaunchPlan =
  | { kind: 'ok'; launch: Launch; fallback: Launch | null }
  | { kind: 'unavailable'; detail: string };

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

const stepDirOf = (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine,
): string => joinPath(worktreeOf(runtime, job), CELL_DIR, station.stationId);

const tailOf = (text: string): string => text.slice(-OUTPUT_TAIL_CHARS);

const nextJobOf = (reply: TransitionReply): ClaimedJob | null =>
  'nextJob' in reply ? reply.nextJob : null;

const logLine = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  action: string,
  detail?: string,
): Promise<void> => {
  try {
    await runtime.ports.fs.appendText(
      runtime.logPath,
      `${renderLogLine({
        at: runtime.ports.clock.now(),
        order: slugOf(job.orderId),
        station: stationNames.get(job) ?? '-',
        action,
        detail,
      })}\n`,
    );
  } catch {
    // the log is for watching only; a write failure must not stop the job
  }
};

const transition = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  body: TransitionBody<TransitionCommand>,
): Promise<TransitionReply> => {
  await logLine(
    runtime,
    job,
    body.action,
    'detail' in body ? body.detail : undefined,
  );
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
  // Step dirs are named by station id: server step ids are only known after `start`.
  for (const prior of job.expectedPriorSteps) {
    const file = `.cell/${prior.stationId}/state.json`;
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
  if (station === undefined) {
    return [];
  }
  const dir = stepDirOf(runtime, job, station);
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
  const promptPath = joinPath(CELL_DIR, station.stationId, PROMPT_FILE);
  const logPath = joinPath(stepDirOf(runtime, job, station), STEP_LOG);
  const options = {
    model: station.model ?? undefined,
    permission: station.permission,
  };
  const headless = runners.commandLine(runner, promptPath, options);
  if (headless === undefined) {
    return { kind: 'unavailable', detail: `no runner adapter: ${runner}` };
  }
  const headlessLaunch: Launch = { ...headless, logPath, interactive: false };
  const tui =
    !station.headless && (await runtime.ports.runner.interactiveAvailable())
      ? runners.commandLine(runner, promptPath, {
          ...options,
          interactive: true,
        })
      : undefined;
  return tui === undefined
    ? { kind: 'ok', launch: headlessLaunch, fallback: null }
    : {
        kind: 'ok',
        launch: { ...tui, logPath, interactive: true },
        fallback: headlessLaunch,
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

const writeFeedback = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  text: string,
): Promise<void> => {
  if (station !== undefined) {
    await runtime.ports.fs.writeText(
      joinPath(stepDirOf(runtime, job, station), FEEDBACK_FILE),
      text,
    );
  }
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
    await writeFeedback(runtime, job, station, '');
    if (station !== undefined) {
      await runtime.ports.fs.writeText(
        joinPath(stepDirOf(runtime, job, station), STATE_FILE),
        `${JSON.stringify({ jobId: job.jobId, epoch: job.epoch, outcome: 'complete' })}\n`,
      );
    }
    const worktree = worktreeOf(runtime, job);
    // The server needs a sha on every complete; a station that changed nothing reports the current HEAD.
    commitSha =
      (await checkpointStation(runtime.ports, {
        worktree,
        slug: slugOf(job.orderId),
        stepId: station?.stationId ?? '',
        producedFiles: produced,
      })) ?? (await runtime.ports.git.headSha(worktree));
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
    case 'drain-force':
      await leaveCell(runtime, job);
      return null;
    case 'timeout':
      return finishWithFail(
        runtime,
        job,
        `station timed out after ${Math.round((station?.timeoutMs ?? 0) / MS_PER_MINUTE)}m`,
      );
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
      if (outcome.outcome === 'pass') {
        return finishComplete(runtime, job, station);
      }
      await writeFeedback(runtime, job, station, outcome.feedback);
      return finishWithFail(runtime, job, outcome.feedback);
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

const beatOnce = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<readonly string[]> => {
  const { signals } = heartbeatCellContract.out[200].parse(
    await runtime.ports.server.call(
      HEARTBEATS_ROUTE,
      { jobId: job.jobId, epoch: job.epoch },
      runtime.session.sessionToken,
    ),
  );
  observeDrain(runtime.drain, signals);
  return signals;
};

// Keeps the lease alive while the Cell itself works (setup, inspection), with no runner to abort.
const whileBeating = async <T>(
  runtime: CellRuntime,
  job: ClaimedJob,
  work: () => Promise<T>,
): Promise<T> => {
  const heartbeat = startHeartbeat({
    clock: runtime.ports.clock,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    beat: () => beatOnce(runtime, job),
    onAbort: () => undefined,
  });
  try {
    return await work();
  } finally {
    heartbeat.stop();
  }
};

const runShell = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  commands: readonly string[],
  logPath: string,
): Promise<string | null> => {
  if (commands.length === 0) {
    return null;
  }
  let log = '';
  try {
    return await whileBeating(runtime, job, async () => {
      for (const command of commands) {
        const result = await runtime.ports.process.run(
          SHELL,
          ['-lc', command],
          worktreeOf(runtime, job),
        );
        const output = `${result.stdout}${result.stderr}`;
        log += `$ ${command}\n${output}\n`;
        if (result.exitCode !== 0) {
          return `${command} exited with code ${result.exitCode}: ${tailOf(output)}`;
        }
      }
      return null;
    });
  } finally {
    await runtime.ports.fs.writeText(logPath, log);
  }
};

const prepareWorktree = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
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
      lineName: snapshot.name,
      baseBranch: job.baseBranch,
      baseCommitSha: job.baseCommitSha,
      cellId: runtime.session.cellId,
    };
    await fs.writeText(
      joinPath(worktree, CELL_DIR, WORKTREE_FILE),
      `${JSON.stringify(record, null, WORKTREE_JSON_INDENT)}\n`,
    );
    const setupFailure = await runShell(
      runtime,
      job,
      snapshot.setup,
      joinPath(worktree, CELL_DIR, SETUP_LOG),
    );
    return setupFailure === null
      ? null
      : `workspace setup failed: ${setupFailure}`;
  } catch (error) {
    return `workspace failed: ${errorText(error)}`;
  }
};

const taskTextOf = (job: ClaimedJob): string => {
  const task = stepPayloadSchema.parse(job.payload).task;
  return task === undefined
    ? `# ${job.orderId ?? job.jobId}\n`
    : `# ${task.title}\n\nType: ${task.type}\n\n${task.description}\n`;
};

const readProfile = async (
  runtime: CellRuntime,
  profile: string | null,
): Promise<string | null> =>
  profile === null
    ? null
    : runtime.ports.fs.readText(
        joinPath(
          runtime.repoRoot,
          OPERATORS_DIR,
          `${profile}${PROFILE_SUFFIX}`,
        ),
      );

// An input `<station>.<artifact>` names a file the station wrote under `.cell/<station>/`.
const inputPathOf = async (
  runtime: CellRuntime,
  snapshot: LineSnapshot,
  input: string,
): Promise<string | null> => {
  const [stationId, artifact] = input.split('.');
  const source = snapshot.stations.find((item) => item.stationId === stationId);
  if (
    source === undefined ||
    stationId === undefined ||
    artifact === undefined
  ) {
    return null;
  }
  const profile = await readProfile(runtime, source.profile);
  if (profile === null) {
    return joinPath(CELL_DIR, stationId, STEP_LOG);
  }
  const file = profileArtifacts(profile)[artifact] ?? `${artifact}.md`;
  return joinPath(CELL_DIR, stationId, file);
};

const readIfPresent = async (
  runtime: CellRuntime,
  path: string,
): Promise<string> =>
  (await runtime.ports.fs.exists(path))
    ? (await runtime.ports.fs.readText(path)).trim()
    : '';

const diffOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<string> => {
  try {
    const result = await runtime.ports.process.run(
      'git',
      ['diff', `${job.baseBranch}...HEAD`],
      worktreeOf(runtime, job),
    );
    return result.exitCode === 0 ? result.stdout.slice(0, MAX_DIFF_CHARS) : '';
  } catch {
    return '';
  }
};

const contextOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
  station: StepLine,
  inputs: readonly { name: string; path: string }[],
): Promise<string> => {
  const worktree = worktreeOf(runtime, job);
  const sections: string[] = [];
  for (const prior of snapshot.stations.slice(0, station.stepIndex)) {
    const log = await readIfPresent(
      runtime,
      joinPath(worktree, CELL_DIR, prior.stationId, STEP_LOG),
    );
    if (prior.kind === 'inspection' && log !== '') {
      sections.push(
        `### Gate result: ${prior.stationId}\n\nPassed (the Cell moves past a gate only when it passes).\n\n\`\`\`text\n${tailOf(log)}\n\`\`\``,
      );
    }
  }
  for (const later of snapshot.stations.slice(station.stepIndex + 1)) {
    const feedback = await readIfPresent(
      runtime,
      joinPath(worktree, CELL_DIR, later.stationId, FEEDBACK_FILE),
    );
    if (feedback !== '') {
      sections.push(`### Feedback from ${later.stationId}\n\n${feedback}`);
    }
  }
  for (const input of inputs) {
    const text = await readIfPresent(runtime, joinPath(worktree, input.path));
    sections.push(
      `### Input ${input.name} (\`${input.path}\`)\n\n${text === '' ? '(missing)' : text}`,
    );
  }
  if (station.stepIndex > 0) {
    const diff = await diffOf(runtime, job);
    sections.push(
      `### Diff against ${job.baseBranch}\n\n${diff === '' ? '(no committed change yet)' : `\`\`\`diff\n${diff}\n\`\`\``}`,
    );
  }
  return sections.join('\n\n');
};

const writePrompt = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
  station: StepLine,
): Promise<string | null> => {
  const { fs } = runtime.ports;
  const worktree = worktreeOf(runtime, job);
  const stepDir = joinPath(CELL_DIR, station.stationId);
  try {
    const profile = await readProfile(runtime, station.profile);
    const inputs: { name: string; path: string }[] = [];
    for (const name of station.inputs) {
      const path = await inputPathOf(runtime, snapshot, name);
      if (path !== null) inputs.push({ name, path });
    }
    await fs.writeText(
      joinPath(worktree, CELL_DIR, TASK_FILE),
      taskTextOf(job),
    );
    await fs.writeText(
      joinPath(worktree, stepDir, PROMPT_FILE),
      renderOperatorPrompt({
        profile,
        taskId: slugOf(job.orderId),
        attemptId: String(job.epoch),
        stepDir,
        evidenceDir: joinPath(worktree, stepDir, EVIDENCE_DIR),
        inputs: [
          joinPath(CELL_DIR, TASK_FILE),
          ...inputs.map((input) => input.path),
        ],
        context: await contextOf(runtime, job, snapshot, station, inputs),
        operatorCommand: operatorCommandOf(),
      }),
    );
    return null;
  } catch (error) {
    return `prompt failed: ${errorText(error)}`;
  }
};

const inspect = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine,
): Promise<ClaimedJob | null> => {
  const failure = await runShell(
    runtime,
    job,
    station.exec,
    joinPath(stepDirOf(runtime, job, station), STEP_LOG),
  );
  if (failure === null) {
    return finishComplete(runtime, job, station);
  }
  await writeFeedback(runtime, job, station, failure);
  return finishWithFail(runtime, job, failure);
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
  await transition(runtime, job, {
    action: 'start',
    lineSnapshot: wireSnapshotOf(snapshot),
  });
  if (snapshot.requireAdr) {
    const added = await runtime.ports.process.run(
      'git',
      [
        'diff',
        '--name-only',
        '--diff-filter=A',
        `${job.baseBranch}...HEAD`,
        '--',
        DECISIONS_DIR,
      ],
      worktreeOf(runtime, job),
    );
    const count = added.stdout.split('\n').filter(Boolean).length;
    if (added.exitCode !== 0 || count !== 1) {
      return finishWithFail(
        runtime,
        job,
        `delivery failed: requireAdr needs exactly one new ${DECISIONS_DIR} entry, found ${count}`,
      );
    }
  }
  try {
    const commitSha = await deliverWorkOrder(runtime.ports, {
      repoRoot: runtime.repoRoot,
      worktree: worktreeOf(runtime, job),
      slug: slugOf(job.orderId),
      baseBranch: job.baseBranch,
      priorStepIds: job.expectedPriorSteps.map((step) => step.stationId),
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
  plan: { launch: Launch; fallback: Launch | null },
): Promise<ClaimedJob | null> => {
  const { ports } = runtime;
  const cycleToken = cycleTokenOf();
  const end = deferred<RunEnd>();
  const endpoint = await ports.operator.open(
    toJobId(job.jobId),
    operatorHandler(cycleToken, end),
  );
  const startRun = (launch: Launch) =>
    ports.runner.start({
      ...launch,
      cwd: worktreeOf(runtime, job),
      env: {
        FACTORY_OPERATOR_URL: endpoint.url,
        FACTORY_CYCLE_TOKEN: cycleToken,
      },
    });
  let mode = { interactive: plan.launch.interactive, reason: '' };
  let handle: Awaited<ReturnType<typeof startRun>>;
  try {
    handle = await startRun(plan.launch);
  } catch (error) {
    // A pane that cannot open must not fail the step: run it headless once instead.
    if (plan.fallback === null) throw error;
    mode = { interactive: false, reason: errorText(error) };
    handle = await startRun(plan.fallback);
  }
  if (station !== undefined) {
    await ports.fs.writeText(
      joinPath(stepDirOf(runtime, job, station), RUNNER_FILE),
      `${JSON.stringify(mode)}\n`,
    );
  }
  await logLine(
    runtime,
    job,
    mode.interactive ? 'pane' : 'headless',
    mode.reason,
  );
  let ended = false;
  if (station?.timeoutMs) {
    void ports.clock.sleep(station.timeoutMs).then(() => {
      if (ended) return;
      end.resolve({ kind: 'timeout' });
      void ports.runner.abort(handle);
    });
  }
  let forced = false;
  const heartbeat = startHeartbeat({
    clock: ports.clock,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    beat: async () => {
      const signals = await beatOnce(runtime, job);
      if (
        !forced &&
        drainPolicy({
          jobHeld: true,
          force: runtime.drain.force,
          stationFinished: false,
        }) === 'abort_then_leave'
      ) {
        forced = true;
        end.resolve({ kind: 'drain-force' });
        void ports.runner.abort(handle);
      }
      return signals;
    },
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
    const outcome = await end.promise;
    ended = true;
    // A TUI stays open after its verb; close its tab once the step has reported.
    if (mode.interactive && outcome.kind === 'operator') {
      await ports.runner.abort(handle);
    }
    return await finish(runtime, job, station, outcome);
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
  const { snapshot, station } = line;
  stationNames.set(job, station?.stationId ?? '-');
  if (station?.kind === 'deliver') {
    return deliverStation(runtime, job, snapshot);
  }
  if (station?.kind === 'inspection') {
    const missing = await missingPriorFiles(runtime, job);
    if (missing !== null) {
      return worktreeMissingOf(runtime, job, missing);
    }
    await transition(runtime, job, {
      action: 'start',
      lineSnapshot: wireSnapshotOf(snapshot),
    });
    return inspect(runtime, job, station);
  }
  const plan = await launchOf(runtime, job, station);
  if (plan.kind === 'unavailable') {
    return lineUnavailable(runtime, job, snapshot.name, plan.detail);
  }
  const missing = await missingPriorFiles(runtime, job);
  if (missing !== null) {
    return worktreeMissingOf(runtime, job, missing);
  }
  await transition(runtime, job, {
    action: 'start',
    lineSnapshot: wireSnapshotOf(snapshot),
  });
  if (job.expectedPriorSteps.length === 0) {
    const failure = await prepareWorktree(runtime, job, snapshot);
    if (failure !== null) {
      return finishWithFail(runtime, job, failure);
    }
  }
  const promptFailure =
    station === undefined
      ? null
      : await writePrompt(runtime, job, snapshot, station);
  if (promptFailure !== null) {
    return finishWithFail(runtime, job, promptFailure);
  }
  return execute(runtime, job, station, plan);
};
