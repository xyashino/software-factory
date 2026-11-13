import { basename } from 'node:path';
import type { Workflow } from '../definitions/types';
import type { AgentObservation } from '../ports/herdr.port';
import { reduce } from '../engine/reduce';
import { watch, watchPolicyFor, type Observation } from '../engine/watch';
import type { AttemptState, TaskState } from '../engine/state';
import { renderTemplate } from '../prompts/render';
import type { SupervisorPorts } from './ports';
import { plainPaint, type Paint } from '../paint';
import { consoleLine, heartbeatText } from './console-lines';
import { agentName } from './names';
import { settleOperator } from './operator';
import { nonEmptyFile } from './util';
import { confirmTrustPrompt } from './trust-prompt';

/** How long one observation waits for the agent to change state. */
export const WAIT_MS = 2_000;

/** Last pane snapshot per attempt, to tell when the agent last printed something. */
const lastOutput = new Map<string, { hash: string; at: number }>();

/** Heartbeats are printed at most this often per running attempt. */
export const HEARTBEAT_MS = 60_000;

/** When each live attempt last printed a heartbeat; dropped once it is not live. */
const lastHeartbeat = new Map<string, number>();

/** Drops the heartbeat record of an attempt that is no longer running. */
export const forgetHeartbeat = (attemptId: string): void => {
  lastHeartbeat.delete(attemptId);
};

/** Watches one running agent attempt once and acts on the decision. */
export const watchAttempt = async (
  ports: SupervisorPorts,
  taskId: string,
  workflow: Workflow,
  attemptId: string,
  log: (line: string) => void = () => undefined,
  paint: Paint = plainPaint,
): Promise<void> => {
  const state = reduce(workflow, ports.store.events(taskId));
  const attempt = findAttempt(state, attemptId);
  if (attempt === undefined) return;
  const isOperator = attempt === state.operator;
  if (isOperator && !isLive(attempt)) {
    // The operator ended: check its worktree and the incident once.
    if (!state.operatorChecked) {
      await settleOperator(ports, taskId, workflow, attempt);
    }
    return;
  }
  if (!isLive(attempt)) {
    lastHeartbeat.delete(attemptId);
    return;
  }
  if (!isOperator) {
    const step = workflow.steps.find((item) => item.id === attempt.stepId);
    if (step?.type !== 'agent') return;
  }

  const name = agentName(taskId, attempt.stepId, attempt.n);
  const observation = await observe(ports, name, attempt);
  // A folder-trust screen blocks the agent with no question for a human: confirm it
  // and look again on the next tick. Any other blocked screen stays a runner prompt.
  if (observation.agent === 'blocked') {
    const confirmed = await confirmTrustPrompt(ports.herdr, name).catch(
      () => false,
    );
    if (confirmed) return;
  }
  // The agent may have finished while we waited; decide on the log as it is now.
  const latest = findAttempt(
    reduce(workflow, ports.store.events(taskId)),
    attemptId,
  );
  if (latest === undefined || !isLive(latest)) {
    lastHeartbeat.delete(attemptId);
    return;
  }
  const now = ports.clock.now();
  if (
    now - (lastHeartbeat.get(attemptId) ?? attempt.startedAt) >=
    HEARTBEAT_MS
  ) {
    lastHeartbeat.set(attemptId, now);
    log(
      consoleLine(
        workflow.name,
        heartbeatText(
          attempt.stepId,
          now - attempt.startedAt,
          now - observation.lastOutputAt,
          paint,
        ),
      ),
    );
  }
  const decision = watch(
    latest,
    observation,
    ports.clock.now(),
    watchPolicyFor(workflow, attempt.stepId),
  );

  switch (decision.type) {
    case 'none':
      return;
    case 'remind': {
      // A reminder that cannot be delivered is retried on the next tick; it must
      // not park the whole task, since the agent may still be working.
      let sent: 'accepted' | 'blocked';
      try {
        sent = await sendReminder(
          ports,
          workflow,
          name,
          attempt,
          decision.kind,
        );
      } catch {
        return;
      }
      if (sent === 'blocked') {
        ports.store.append(taskId, {
          type: 'blocked',
          reason: 'runner_prompt',
          detail: `agent ${name} blocked on a prompt`,
        });
        return;
      }
      ports.store.append(taskId, {
        type: 'reminder_sent',
        attemptId,
        kind: decision.kind,
      });
      return;
    }
    case 'fail':
      ports.store.append(taskId, {
        type: 'attempt_failed',
        attemptId,
        reason: decision.reason,
        detail: `${name}: ${decision.reason}`,
      });
      return;
    case 'block':
      if (isOperator) {
        // The operator cannot triage itself: a stuck operator fails its attempt.
        ports.store.append(taskId, {
          type: 'attempt_failed',
          attemptId,
          reason: 'stalled',
          detail: `${name}: blocked on a runner prompt`,
        });
        return;
      }
      ports.store.append(taskId, {
        type: 'blocked',
        reason: decision.reason,
        detail: `agent ${name} is waiting on a runner prompt`,
      });
      return;
  }
};

const findAttempt = (
  state: TaskState,
  attemptId: string,
): AttemptState | undefined => {
  return [...state.attempts, state.operator].find(
    (attempt) => attempt?.attemptId === attemptId,
  );
};

const isLive = (attempt: AttemptState): boolean => {
  return attempt.status === 'starting' || attempt.status === 'running';
};

/** Herdr's view of the agent, plus whether its pane printed anything since the last look. */
export const observe = async (
  ports: SupervisorPorts,
  name: string,
  attempt: AttemptState,
): Promise<Observation> => {
  const now = ports.clock.now();
  let status: AgentObservation;
  try {
    status = await ports.herdr.wait(name, WAIT_MS);
  } catch {
    status = 'unknown';
  }
  let pane = '';
  if (status !== 'unknown') {
    try {
      pane = await ports.herdr.read(name, 200);
    } catch {
      pane = '';
    }
  }
  const hash = String(Bun.hash(pane));
  const previous = lastOutput.get(attempt.attemptId) ?? {
    hash: '',
    at: attempt.startedAt,
  };
  const changed = hash !== previous.hash;
  const lastOutputAt = changed ? now : previous.at;
  lastOutput.set(attempt.attemptId, { hash, at: lastOutputAt });

  return { agent: await toAgentState(ports, name, status), lastOutputAt };
};

const toAgentState = async (
  ports: SupervisorPorts,
  name: string,
  status: AgentObservation,
): Promise<Observation['agent']> => {
  switch (status) {
    case 'idle':
    case 'done':
      return 'idle';
    case 'working':
    case 'timeout':
      return 'working';
    case 'blocked':
      return 'blocked';
    case 'unknown':
      try {
        return (await ports.herdr.exists(name)) ? 'unknown' : 'gone';
      } catch {
        // Herdr could not answer: not knowing is not the agent being gone. Keep watching.
        return 'unknown';
      }
  }
};

const sendReminder = async (
  ports: SupervisorPorts,
  workflow: Workflow,
  name: string,
  attempt: AttemptState,
  kind: 'idle' | 'silent',
): Promise<'accepted' | 'blocked'> => {
  const policy = watchPolicyFor(workflow, attempt.stepId);
  const text =
    kind === 'idle'
      ? renderTemplate(templateBody(ports, 'reminder-idle'), {
          missing: missingArtifacts(attempt),
          count: String(attempt.reminders.idle + 1),
          limit: String(policy.idleReminders),
        })
      : renderTemplate(templateBody(ports, 'nudge-silent'), {
          minutes: String(Math.round(policy.silentMs / 60_000)),
        });
  return ports.herdr.prompt(name, text);
};

const templateBody = (ports: SupervisorPorts, id: string): string => {
  const template = ports.definitions.templates.get(id);
  if (template === undefined) throw new Error(`template "${id}" is not loaded`);
  return template.body;
};

/** One bullet per declared artifact that is still missing or empty. */
export const missingArtifacts = (attempt: AttemptState): string => {
  const missing = Object.values(attempt.artifacts)
    .filter((path) => !nonEmptyFile(path))
    .map((path) => `- ${basename(path)}`);
  return missing.length === 0 ? '- (none: run sf done)' : missing.join('\n');
};
