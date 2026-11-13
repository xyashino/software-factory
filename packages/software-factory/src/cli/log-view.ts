import type { StoredEvent } from '../ports/store.port';
import { plainPaint, type Paint } from '../paint';

type Tone = 'red' | 'yellow' | 'green' | 'cyan' | 'plain';

/** One human line per event: time, type, and the facts a reader needs. */
export const logLines = (
  events: readonly StoredEvent[],
  paint: Paint = plainPaint,
): string[] => {
  return events.map((stored) => {
    const time = new Date(stored.at).toISOString().slice(11, 23);
    const tone = toneOf(stored);
    const type = stored.event.type.padEnd(16);
    const typeText = tone === 'plain' ? type : paint[tone](type);
    return `${paint.dim(time)}  ${typeText} ${summaryOf(stored, paint)}`.trimEnd();
  });
};

const toneOf = (stored: StoredEvent): Tone => {
  const event = stored.event;
  switch (event.type) {
    case 'setup_finished':
      return event.ok ? 'green' : 'red';
    case 'gate_finished':
      return event.passed ? 'green' : 'red';
    case 'verdict':
      return event.pass ? 'green' : 'red';
    case 'attempt_failed':
    case 'blocked':
    case 'delivery_failed':
    case 'delivered_blocked':
      return 'red';
    case 'question_asked':
      return 'yellow';
    case 'delivered':
    case 'completed':
      return 'green';
    case 'task_created':
    case 'attempt_started':
    case 'agent_ready':
      return 'cyan';
    default:
      return 'plain';
  }
};

const summaryOf = (stored: StoredEvent, paint: Paint): string => {
  const event = stored.event;
  switch (event.type) {
    case 'task_created':
      return `${event.workflow} ${event.todoPath}`;
    case 'setup_finished':
      return event.ok ? paint.green('ok') : paint.red(`failed (${event.log})`);
    case 'attempt_started':
      return `${event.stepId}#${event.n} ${event.attemptId}`;
    case 'agent_ready':
      return `pane ${event.pane}`;
    case 'completed':
      return event.attemptId;
    case 'verdict':
      if (event.pass) return paint.green('pass');
      return [
        paint.red('fail'),
        event.feedbackPath === undefined ? '' : paint.dim(event.feedbackPath),
      ]
        .filter((part) => part.length > 0)
        .join(' ');
    case 'gate_finished':
      return event.passed
        ? paint.green('passed')
        : paint.red(
            `failed: ${event.failures.map((failure) => failure.command).join(', ')}`,
          );
    case 'attempt_failed':
      return `${event.reason}: ${event.detail}`;
    case 'usage_recorded':
      return `${event.model} ${event.inputTokens} in / ${event.outputTokens} out${
        event.costUsd === undefined ? '' : ` $${event.costUsd.toFixed(4)}`
      }`;
    case 'reminder_sent':
      return event.kind;
    case 'question_asked':
      return `${event.to}: ${event.text}`;
    case 'answered':
      return `${event.by}: ${event.text}`;
    case 'note':
      return `${event.to}: ${event.text}`;
    case 'blocked':
      return `${event.reason}: ${event.detail}`;
    case 'unblocked':
      return [
        event.by,
        event.extraRetry === true ? 'extra retry' : '',
        event.nudge === undefined ? '' : `nudge: ${event.nudge}`,
      ]
        .filter((part) => part.length > 0)
        .join(' ');
    case 'escalated':
      return event.text;
    case 'prompt_delivered':
      return `${event.kind} -> ${event.attemptId}`;
    case 'operator_checked':
      return event.changed ? 'worktree changed' : 'worktree untouched';
    case 'delivery_started':
      return event.to;
    case 'delivered':
      return event.prUrl;
    case 'delivered_blocked':
      return event.prUrl;
    case 'delivery_failed':
      return event.detail;
    default:
      return '';
  }
};
