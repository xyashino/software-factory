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
import type { RunHandle } from '../../ports/runner.port';
import { commandIdOf } from '../../../domain/cell/command-id';
import { renderLogLine } from '../../../domain/cell/log-line';
import type { OperatorOutcome } from '../../../domain/cell/cell-loop';
import { drainPolicy } from '../../../domain/cell/drain-policy';
import {
  lockVerdictOf,
  parseStepLock,
  type StepLock,
} from '../../../domain/cell/step-lock';
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
const MS_PER_SECOND = 1000;
const MECHANIC_DIR = 'mechanic';
const REPORT_FILE = 'report.md';
const STEP_ACTIONS: readonly string[] = ['retry_step', 'restart_from_step'];
// The station a claimed job runs, for log lines; set once its line is loaded.
const stationNames = new WeakMap<ClaimedJob, string>();

type TransitionCommand = z.infer<typeof transitionJobContract.in.body>;
type TransitionBody<C> = C extends unknown
  ? Omit<C, 'commandId' | 'epoch'>
  : never;
type TransitionReply = z.infer<(typeof transitionJobContract.out)[200]>;
type StepLine = LineSnapshot['stations'][number];
type IncidentOutcome = Extract<OperatorOutcome, { kind: 'incident' }>;

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

/** Who runs a job's operator: its runner, and the `.cell/<dir>` it keeps its prompt, log and state in. */
interface Agent {
  dir: string;
  runner: string | null;
  model: string | null;
  permission: 'read' | 'write';
  headless: boolean;
}

/** What a mechanic job answers while it runs: its incident state, and the station a step name stands for. */
interface Serving {
  read: () => Promise<Record<string, unknown>>;
  stepIndexOf: (stationId: string) => number | undefined;
}

interface Run {
  dir: string;
  plan: { launch: Launch; fallback: Launch | null };
  timeoutMs: number | null;
  serving: Serving | null;
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

const dirOf = (runtime: CellRuntime, job: ClaimedJob, dir: string): string =>
  joinPath(worktreeOf(runtime, job), CELL_DIR, dir);

const stepDirOf = (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine,
): string => dirOf(runtime, job, station.stationId);

const agentOf = (station: StepLine): Agent => ({
  dir: station.stationId,
  runner: station.runner,
  model: station.model,
  permission: station.permission,
  headless: station.headless,
});

const tailOf = (text: string): string => text.slice(-OUTPUT_TAIL_CHARS);

const secondsOf = (ms: number): string => `${Math.round(ms / MS_PER_SECOND)}s`;

const agentDetailOf = (agent: Agent): string =>
  `runner=${agent.runner ?? '-'} model=${agent.model ?? '-'} headless=${agent.headless}`;

const attemptOf = (job: ClaimedJob, station: StepLine): string =>
  `(${job.epoch}/${station.maxAttempts})`;

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
  logDetail?: string | null,
): Promise<TransitionReply> => {
  if (logDetail !== null) {
    await logLine(
      runtime,
      job,
      body.action,
      logDetail ?? ('detail' in body ? body.detail : undefined),
    );
  }
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
  agent: Agent,
): Promise<LaunchPlan> => {
  const runner = agent.runner;
  if (runner === null) {
    return { kind: 'unavailable', detail: 'station names no runner' };
  }
  const { runners } = runtime.ports;
  if (!(await runners.isInstalled(runner))) {
    return { kind: 'unavailable', detail: `runner not installed: ${runner}` };
  }
  const promptPath = joinPath(CELL_DIR, agent.dir, PROMPT_FILE);
  const logPath = joinPath(dirOf(runtime, job, agent.dir), STEP_LOG);
  const options = {
    model: agent.model ?? undefined,
    permission: agent.permission,
  };
  const headless = runners.commandLine(runner, promptPath, options);
  if (headless === undefined) {
    return { kind: 'unavailable', detail: `no runner adapter: ${runner}` };
  }
  const headlessLaunch: Launch = { ...headless, logPath, interactive: false };
  const tui =
    !agent.headless && (await runtime.ports.runner.interactiveAvailable())
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

const notServed = (verb: string) => ({
  code: 400,
  type: 'invalid',
  message: `verb ${verb} is not served by the cell loop`,
});

const operatorHandler =
  (cycleToken: string, end: Deferred<RunEnd>, serving: Serving | null) =>
  async (request: unknown): Promise<unknown> => {
    const parsed = operatorRequest.safeParse(request);
    if (!parsed.success) {
      return { code: 400, type: 'invalid', message: 'unknown operator verb' };
    }
    const verb = parsed.data;
    if (verb.token !== cycleToken) {
      return { code: 401, type: 'unauthorized', message: 'bad cycle token' };
    }
    if (serving === null) {
      const outcome = outcomeOf(verb);
      if (outcome === null) {
        return notServed(verb.verb);
      }
      end.resolve({ kind: 'operator', outcome });
      return { code: 200 };
    }
    if (verb.verb === 'read') {
      return { code: 200, ...(await serving.read()) };
    }
    if (verb.verb !== 'incident') {
      return notServed(verb.verb);
    }
    const takesStep = STEP_ACTIONS.includes(verb.action);
    const stepIndex =
      takesStep && verb.step !== undefined
        ? serving.stepIndexOf(verb.step)
        : undefined;
    if (takesStep && stepIndex === undefined) {
      return {
        code: 400,
        type: 'invalid',
        message: `${verb.action} needs --step to name a station of the line`,
      };
    }
    end.resolve({
      kind: 'operator',
      outcome: {
        kind: 'incident',
        action: verb.action,
        stepIndex,
        diagnosis: verb.diagnosis,
        tried: verb.outcome,
        report: verb.report,
      },
    });
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
  ran?: string,
): Promise<ClaimedJob | null> =>
  nextJobOf(
    await transition(
      runtime,
      job,
      { action: 'fail', detail },
      ran === undefined ? undefined : `${ran} ${detail}`,
    ),
  );

const finishComplete = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  ran?: string | null,
): Promise<ClaimedJob | null> => {
  const missing = await missingRequiredFiles(runtime, job, station);
  if (missing.length > 0) {
    return finishWithFail(
      runtime,
      job,
      `missing required files: ${missing.join(', ')}`,
      ran ?? undefined,
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
      ran ?? undefined,
    );
  }
  return nextJobOf(
    await transition(
      runtime,
      job,
      { action: 'complete', producedFiles: produced, commitSha },
      ran,
    ),
  );
};

const finish = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  end: RunEnd,
  ran: string,
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
        ran,
      );
    case 'exited':
      return finishWithFail(
        runtime,
        job,
        `runner exited with code ${end.exitCode} before a verdict`,
        ran,
      );
    case 'operator':
      return finishOperator(runtime, job, station, end.outcome, ran);
  }
};

const finishOperator = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine | undefined,
  outcome: OperatorOutcome,
  ran: string,
): Promise<ClaimedJob | null> => {
  switch (outcome.kind) {
    case 'done':
      return finishComplete(runtime, job, station, ran);
    case 'verdict':
      if (outcome.outcome === 'pass') {
        return finishComplete(runtime, job, station, ran);
      }
      await writeFeedback(runtime, job, station, outcome.feedback);
      return finishWithFail(runtime, job, outcome.feedback, ran);
    case 'block':
      return nextJobOf(
        await transition(
          runtime,
          job,
          { action: 'block', detail: outcome.reason },
          `${ran} ${outcome.reason}`,
        ),
      );
    case 'incident':
      return finishWithFail(
        runtime,
        job,
        'incident resolution needs a mechanic job',
      );
  }
};

const worktreeMissingOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  missing: { stepId: string; files: string[] },
): Promise<ClaimedJob | null> =>
  nextJobOf(
    await transition(
      runtime,
      job,
      {
        action: 'worktree_missing',
        missingStepId: missing.stepId,
        missingFiles: missing.files,
      },
      `missing ${missing.files.join(', ')}`,
    ),
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
  attempt?: string,
): Promise<string | null> => {
  if (commands.length === 0) {
    return null;
  }
  let log = '';
  try {
    return await whileBeating(runtime, job, async () => {
      for (const command of commands) {
        const startedAt = runtime.ports.clock.now();
        if (attempt !== undefined) {
          await logLine(
            runtime,
            job,
            'start',
            `${attempt} command=${JSON.stringify(command)}`,
          );
        }
        const result = await runtime.ports.process.run(
          SHELL,
          ['-lc', command],
          worktreeOf(runtime, job),
        );
        if (attempt !== undefined) {
          await logLine(
            runtime,
            job,
            'complete',
            `${attempt} exit=${result.exitCode} duration=${secondsOf(runtime.ports.clock.now() - startedAt)}`,
          );
        }
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
    if (await fs.exists(worktree)) {
      await logLine(runtime, job, 'worktree', `reuse path=${worktree}`);
    } else {
      await logLine(
        runtime,
        job,
        'worktree',
        `create path=${worktree} base=${job.baseBranch}`,
      );
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
    attemptOf(job, station),
  );
  if (failure === null) {
    return finishComplete(
      runtime,
      job,
      station,
      station.exec.length > 0 ? null : undefined,
    );
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
  const adrPaths = added.stdout.split('\n').filter(Boolean);
  if (snapshot.requireAdr && (added.exitCode !== 0 || adrPaths.length !== 1)) {
    return finishWithFail(
      runtime,
      job,
      `delivery failed: requireAdr needs exactly one new ${DECISIONS_DIR} entry, found ${adrPaths.length}`,
    );
  }
  try {
    const commitSha = await deliverWorkOrder(runtime.ports, {
      repoRoot: runtime.repoRoot,
      worktree: worktreeOf(runtime, job),
      slug: slugOf(job.orderId),
      baseBranch: job.baseBranch,
      priorStepIds: job.expectedPriorSteps.map((step) => step.stationId),
      taskDescription: stepPayloadSchema.parse(job.payload).task?.description,
      adrPaths: added.exitCode === 0 ? adrPaths : [],
      checks: snapshot.stations
        .filter((station) => station.kind === 'inspection')
        .flatMap((station) => station.exec),
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

const runnerFileOf = (
  runtime: CellRuntime,
  job: ClaimedJob,
  dir: string,
): string => joinPath(dirOf(runtime, job, dir), RUNNER_FILE);

const heldLockOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  dir: string,
): Promise<StepLock | null> => {
  const path = runnerFileOf(runtime, job, dir);
  if (!(await runtime.ports.fs.exists(path))) return null;
  try {
    return parseStepLock(JSON.parse(await runtime.ports.fs.readText(path)));
  } catch {
    return null;
  }
};

const startedAtOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  pid: number,
): Promise<string | null> => {
  const { process: processPort } = runtime.ports;
  if (!processPort.isAlive(pid)) return null;
  const result = await processPort.run(
    'ps',
    ['-o', 'lstart=', '-p', String(pid)],
    worktreeOf(runtime, job),
  );
  const started = result.stdout.trim();
  return result.exitCode === 0 && started !== '' ? started : null;
};

// Refuses while a live runner holds the step dir; a lock whose runner is gone is taken over and logged.
const claimStepLock = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  dir: string,
): Promise<string | null> => {
  const lock = await heldLockOf(runtime, job, dir);
  if (lock === null) return null;
  const observed =
    lock.pid === null ? null : await startedAtOf(runtime, job, lock.pid);
  if (lockVerdictOf(lock, observed) === 'live') {
    return `runner still holds this step: runner=${lock.runId} pid=${lock.pid ?? 'unknown'} pane=${lock.pane ?? '-'}`;
  }
  await logLine(
    runtime,
    job,
    'lock',
    `takeover stale runner=${lock.runId} pid=${lock.pid ?? '-'}`,
  );
  return null;
};

const lockOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  handle: RunHandle,
): Promise<StepLock> => {
  const pid = handle.pid ?? null;
  // Without a confirmed start time the pid cannot be told from a reused one, so the lock records no pid.
  const pidStartedAt =
    pid === null ? null : await startedAtOf(runtime, job, pid);
  return {
    runId: handle.id,
    pid: pidStartedAt === null ? null : pid,
    pidStartedAt,
    pane: handle.pane?.paneId ?? null,
    startedAt: runtime.ports.clock.now(),
  };
};

const writeRunnerFile = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  dir: string,
  mode: { interactive: boolean; reason: string },
  lock: StepLock | null,
): Promise<void> =>
  runtime.ports.fs.writeText(
    runnerFileOf(runtime, job, dir),
    `${JSON.stringify({ ...mode, ...lock })}\n`,
  );

// Runs the operator process for one job and hands its end to `finishRun`, all while the lease is kept alive.
const runOperator = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  run: Run,
  finishRun: (end: RunEnd, ran: string) => Promise<ClaimedJob | null>,
): Promise<ClaimedJob | null> => {
  const { ports } = runtime;
  const refusal = await claimStepLock(runtime, job, run.dir);
  if (refusal !== null) return finishWithFail(runtime, job, refusal);
  const startedAt = ports.clock.now();
  const cycleToken = cycleTokenOf();
  const end = deferred<RunEnd>();
  const endpoint = await ports.operator.open(
    toJobId(job.jobId),
    operatorHandler(cycleToken, end, run.serving),
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
  let mode = { interactive: run.plan.launch.interactive, reason: '' };
  let handle: Awaited<ReturnType<typeof startRun>>;
  try {
    handle = await startRun(run.plan.launch);
  } catch (error) {
    // A pane that cannot open must not fail the step: run it headless once instead.
    if (run.plan.fallback === null) throw error;
    mode = { interactive: false, reason: errorText(error) };
    handle = await startRun(run.plan.fallback);
  }
  await writeRunnerFile(
    runtime,
    job,
    run.dir,
    mode,
    await lockOf(runtime, job, handle),
  );
  const { pane } = handle;
  await logLine(
    runtime,
    job,
    mode.interactive ? 'pane' : 'headless',
    mode.interactive && pane !== undefined
      ? `ws=${pane.workspaceId} tab=${pane.tabId} pane=${pane.paneId}`
      : mode.reason === ''
        ? undefined
        : `fallback=${mode.reason}`,
  );
  const abortRun = async (detail: string): Promise<boolean> => {
    let confirmed = true;
    try {
      confirmed = await ports.runner.abort(handle);
    } catch {
      confirmed = false;
    }
    await logLine(
      runtime,
      job,
      'abort',
      `${detail} confirmed=${confirmed ? 'yes' : 'no'}`,
    );
    return confirmed;
  };
  let ended = false;
  const exit: { code?: number } = {};
  if (run.timeoutMs) {
    void ports.clock.sleep(run.timeoutMs).then(() => {
      if (ended) return;
      end.resolve({ kind: 'timeout' });
    });
  }
  let forced = false;
  let heartbeatFailures = 0;
  let stopped = false;
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
      }
      return signals;
    },
    onAbort: (failures) => {
      heartbeatFailures = failures;
      end.resolve({ kind: 'aborted' });
    },
  });
  void ports.runner.wait(handle).then(
    (outcome) => {
      exit.code = outcome.exitCode;
      end.resolve({ kind: 'exited', exitCode: outcome.exitCode });
    },
    () => {
      exit.code = -1;
      end.resolve({ kind: 'exited', exitCode: -1 });
    },
  );
  try {
    const outcome = await end.promise;
    ended = true;
    // A TUI stays open after its verb, and a stopped run is still alive: both are stopped and confirmed gone here.
    // A headless runner that reported a verb may still be shutting down: its exit is not known yet.
    const stopNeeded =
      exit.code === undefined &&
      (outcome.kind !== 'operator' || mode.interactive);
    const ranOf = (): string =>
      `exit=${exit.code ?? 'pending'} duration=${secondsOf(ports.clock.now() - startedAt)}`;
    await logLine(runtime, job, 'end', `kind=${outcome.kind} ${ranOf()}`);
    const reason =
      outcome.kind === 'aborted'
        ? `heartbeat failures=${heartbeatFailures}`
        : outcome.kind;
    if (stopNeeded) {
      if (!(await abortRun(`reason=${reason}`))) {
        // A second runner must never start in this worktree while the first lives: fail the job and stop claiming.
        await finishWithFail(
          runtime,
          job,
          'runner still alive after abort, Cell left without claiming',
          ranOf(),
        );
        await leaveCell(runtime, null);
        return null;
      }
      stopped = true;
    }
    return await finishRun(outcome, ranOf());
  } finally {
    heartbeat.stop();
    // A headless runner that reported a verb may still be alive: its lock stays until its exit is seen.
    if (exit.code !== undefined || stopped) {
      await writeRunnerFile(runtime, job, run.dir, mode, null);
    }
    await ports.operator.close();
  }
};

const execute = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  station: StepLine,
  plan: { launch: Launch; fallback: Launch | null },
): Promise<ClaimedJob | null> =>
  runOperator(
    runtime,
    job,
    {
      dir: station.stationId,
      plan,
      timeoutMs: station.timeoutMs,
      serving: null,
    },
    (end, ran) => finish(runtime, job, station, end, ran),
  );

const mechanicStateOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
): Promise<Record<string, unknown>> => {
  const worktree = worktreeOf(runtime, job);
  const steps = await Promise.all(
    snapshot.stations.map(async (station) => {
      const dir = joinPath(worktree, CELL_DIR, station.stationId);
      return {
        stationId: station.stationId,
        kind: station.kind,
        state: await readIfPresent(runtime, joinPath(dir, STATE_FILE)),
        log: tailOf(await readIfPresent(runtime, joinPath(dir, STEP_LOG))),
      };
    }),
  );
  return {
    incident: job.payload.incident ?? null,
    steps,
    logs: tailOf(await readIfPresent(runtime, runtime.logPath)),
  };
};

const servingOf = (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
): Serving => ({
  read: () => mechanicStateOf(runtime, job, snapshot),
  stepIndexOf: (stationId) => {
    const index = snapshot.stations.findIndex(
      (station) => station.stationId === stationId,
    );
    return index === -1 ? undefined : index;
  },
});

const writeMechanicPrompt = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  profile: string,
): Promise<string | null> => {
  const { fs } = runtime.ports;
  const worktree = worktreeOf(runtime, job);
  const stepDir = joinPath(CELL_DIR, MECHANIC_DIR);
  try {
    await fs.writeText(
      joinPath(worktree, stepDir, PROMPT_FILE),
      renderOperatorPrompt({
        profile: await readProfile(runtime, profile),
        taskId: slugOf(job.orderId),
        attemptId: String(job.epoch),
        stepDir,
        evidenceDir: joinPath(worktree, stepDir, EVIDENCE_DIR),
        inputs: [],
        context: `### Incident\n\n\`\`\`json\n${JSON.stringify(job.payload.incident ?? null, null, 2)}\n\`\`\``,
        operatorCommand: operatorCommandOf(),
      }),
    );
    return null;
  } catch (error) {
    return `prompt failed: ${errorText(error)}`;
  }
};

const resolveIncidentOf = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  outcome: IncidentOutcome,
  ran: string,
): Promise<ClaimedJob | null> => {
  const incidentId = job.incidentId;
  if (incidentId === null || incidentId === undefined) {
    return finishWithFail(runtime, job, 'mechanic job names no incident');
  }
  await runtime.ports.fs.writeText(
    joinPath(dirOf(runtime, job, MECHANIC_DIR), REPORT_FILE),
    `# Diagnosis\n\n${outcome.diagnosis}\n\n# Tried\n\n${outcome.tried}\n\n${outcome.report}\n`,
  );
  await logLine(runtime, job, 'incident', `${outcome.action} ${ran}`);
  await sendWithRetry(runtime, () =>
    runtime.ports.server.call(
      `/api/v1/incidents/${encodeURIComponent(incidentId)}/resolve`,
      {
        action: outcome.action,
        ...(outcome.stepIndex === undefined
          ? {}
          : { stepIndex: outcome.stepIndex }),
        epoch: job.epoch,
      },
      runtime.session.sessionToken,
    ),
  );
  return null;
};

const finishMechanic = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  timeoutMs: number,
  end: RunEnd,
  ran: string,
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
        `mechanic timed out after ${Math.round(timeoutMs / MS_PER_MINUTE)}m`,
        ran,
      );
    case 'exited':
      return finishWithFail(
        runtime,
        job,
        `mechanic exited with code ${end.exitCode} before an incident resolution`,
        ran,
      );
    case 'operator':
      return end.outcome.kind === 'incident'
        ? resolveIncidentOf(runtime, job, end.outcome, ran)
        : finishWithFail(
            runtime,
            job,
            'mechanic may only resolve an incident',
            ran,
          );
  }
};

const runMechanic = async (
  runtime: CellRuntime,
  job: ClaimedJob,
  snapshot: LineSnapshot,
): Promise<ClaimedJob | null> => {
  const mechanic = snapshot.mechanic;
  if (mechanic === null) {
    return lineUnavailable(
      runtime,
      job,
      snapshot.name,
      'line declares no mechanic',
    );
  }
  const agent: Agent = {
    dir: MECHANIC_DIR,
    runner: mechanic.runner,
    model: mechanic.model,
    permission: mechanic.permission,
    headless: mechanic.headless,
  };
  const plan = await launchOf(runtime, job, agent);
  if (plan.kind === 'unavailable') {
    return lineUnavailable(runtime, job, snapshot.name, plan.detail);
  }
  await transition(
    runtime,
    job,
    { action: 'start', lineSnapshot: wireSnapshotOf(snapshot) },
    agentDetailOf(agent),
  );
  const worktreeFailure = (await runtime.ports.fs.exists(
    worktreeOf(runtime, job),
  ))
    ? null
    : await prepareWorktree(runtime, job, snapshot);
  if (worktreeFailure !== null) {
    return finishWithFail(runtime, job, worktreeFailure);
  }
  const promptFailure = await writeMechanicPrompt(
    runtime,
    job,
    mechanic.profile,
  );
  if (promptFailure !== null) {
    return finishWithFail(runtime, job, promptFailure);
  }
  return runOperator(
    runtime,
    job,
    {
      dir: MECHANIC_DIR,
      plan,
      timeoutMs: mechanic.timeoutMs,
      serving: servingOf(runtime, job, snapshot),
    },
    (end, ran) => finishMechanic(runtime, job, mechanic.timeoutMs, end, ran),
  );
};

export const runJob = async (
  runtime: CellRuntime,
  job: ClaimedJob,
): Promise<ClaimedJob | null> => {
  const line = await loadLine(runtime, job);
  const claimDetail = `job=${job.jobId} kind=${job.kind} epoch=${job.epoch}`;
  if (line.kind === 'unavailable') {
    await logLine(runtime, job, 'claim', claimDetail);
    return lineUnavailable(runtime, job, line.lineName, line.detail);
  }
  const { snapshot, station } = line;
  if (job.kind === 'mechanic') {
    stationNames.set(job, MECHANIC_DIR);
    await logLine(runtime, job, 'claim', claimDetail);
    return runMechanic(runtime, job, snapshot);
  }
  stationNames.set(job, station?.stationId ?? '-');
  await logLine(runtime, job, 'claim', claimDetail);
  if (station?.kind === 'deliver') {
    return deliverStation(runtime, job, snapshot);
  }
  if (station?.kind === 'inspection') {
    const missing = await missingPriorFiles(runtime, job);
    if (missing !== null) {
      return worktreeMissingOf(runtime, job, missing);
    }
    await transition(
      runtime,
      job,
      { action: 'start', lineSnapshot: wireSnapshotOf(snapshot) },
      station.exec.length > 0 ? null : undefined,
    );
    return inspect(runtime, job, station);
  }
  if (station === undefined) {
    return lineUnavailable(
      runtime,
      job,
      snapshot.name,
      'station names no runner',
    );
  }
  const plan = await launchOf(runtime, job, agentOf(station));
  if (plan.kind === 'unavailable') {
    return lineUnavailable(runtime, job, snapshot.name, plan.detail);
  }
  const missing = await missingPriorFiles(runtime, job);
  if (missing !== null) {
    return worktreeMissingOf(runtime, job, missing);
  }
  await transition(
    runtime,
    job,
    { action: 'start', lineSnapshot: wireSnapshotOf(snapshot) },
    agentDetailOf(agentOf(station)),
  );
  if (job.expectedPriorSteps.length === 0) {
    const failure = await prepareWorktree(runtime, job, snapshot);
    if (failure !== null) {
      return finishWithFail(runtime, job, failure);
    }
  }
  const promptFailure = await writePrompt(runtime, job, snapshot, station);
  if (promptFailure !== null) {
    return finishWithFail(runtime, job, promptFailure);
  }
  return execute(runtime, job, station, plan);
};
