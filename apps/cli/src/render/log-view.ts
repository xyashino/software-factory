import type { StoredEvent } from '@repo/factory-core/order/events';
import type { Paint } from './paint';

/** The event families the Traveler colours (PROTOCOL §10): one colour each. */
export type EventFamily =
  'lifecycle' | 'cycle' | 'andon' | 'question' | 'delivery';

const FAMILY: Record<string, EventFamily> = {
  order_created: 'lifecycle',
  spec_updated: 'lifecycle',
  priority_changed: 'lifecycle',
  cancelled: 'lifecycle',
  job_claimed: 'lifecycle',
  job_lost: 'lifecycle',
  workspace_failed: 'lifecycle',
  cycle_started: 'cycle',
  cycle_completed: 'cycle',
  verdict_recorded: 'cycle',
  inspection_progress: 'cycle',
  inspection_finished: 'cycle',
  cycle_failed: 'cycle',
  cycle_blocked: 'cycle',
  cycle_handed_over: 'cycle',
  usage_recorded: 'cycle',
  note_left: 'cycle',
  nudged: 'cycle',
  andon_raised: 'andon',
  resumed: 'andon',
  incident_recorded: 'andon',
  question_asked: 'question',
  question_answered: 'question',
  question_abandoned: 'question',
  reopened: 'delivery',
  delivery_finished: 'delivery',
  delivery_failed: 'delivery',
  pr_state_changed: 'delivery',
};

/** The family of an event type; unknown types count as lifecycle. */
export const familyOf = (type: string): EventFamily =>
  FAMILY[type] ?? 'lifecycle';

/** Paints text in the colour of its family. */
export const paintFamily = (
  paint: Paint,
  family: EventFamily,
  text: string,
): string => {
  switch (family) {
    case 'lifecycle':
      return paint.cyan(text);
    case 'cycle':
      return paint.blue(text);
    case 'andon':
      return paint.red(text);
    case 'question':
      return paint.yellow(text);
    case 'delivery':
      return paint.green(text);
  }
};

/** An id short enough to read in a line: its first eight characters (ULIDs stay unique enough). */
export const shortId = (id: string): string =>
  id.length > 12 ? id.slice(0, 8) : id;

/** The clock of an event: `HH:MM:SS` in UTC, from the Factory clock in milliseconds. */
export const formatClock = (ms: number): string =>
  new Date(ms).toISOString().slice(11, 19);

/** A check's duration for a line: `<1s`, `12s`, or `1m05s`. */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};

/** A summary head, with its detail after a colon when there is one. */
const withDetail = (head: string, detail: string): string =>
  detail ? `${head}: ${detail}` : head;

/** What an event says, in a few words, with ids shortened. */
export const describeEvent = (event: StoredEvent['event']): string => {
  switch (event.type) {
    case 'cycle_started':
      return `cycle ${shortId(event.cycleId)} station ${event.stationId} n=${event.n}`;
    case 'cycle_completed':
      return `cycle ${shortId(event.cycleId)} committed ${event.commit.slice(0, 8)}`;
    case 'inspection_progress': {
      const check = `${event.command} (${event.index}/${event.total})`;
      if (event.phase === 'started') return `▶ ${check}`;
      const duration = formatDuration(event.durationMs ?? 0);
      if (event.timedOut) return `✗ ${check} timed out (${duration})`;
      const passed = event.exitCode === 0;
      const exit = event.exitCode ?? 'without a code';
      return `${passed ? '✓' : '✗'} ${check} exit ${exit} (${duration})`;
    }
    case 'inspection_finished': {
      const passed = event.results.filter(
        (result) => result.exitCode === 0 && !result.timedOut,
      ).length;
      const verdict = event.passed ? 'passed' : 'failed';
      return `cycle ${shortId(event.cycleId)} ${verdict} (${passed}/${event.results.length} checks)`;
    }
    case 'verdict_recorded':
      return `cycle ${shortId(event.cycleId)} verdict ${event.pass ? 'pass' : 'fail'}`;
    case 'cycle_failed':
      return withDetail(
        `cycle ${shortId(event.cycleId)} failed (${event.reason})`,
        event.detail,
      );
    case 'cycle_blocked':
      return withDetail(
        `cycle ${shortId(event.cycleId)} blocked (${event.source}/${event.reason})`,
        event.detail,
      );
    case 'cycle_handed_over':
      return `cycle ${shortId(event.cycleId)}`;
    case 'workspace_failed':
      return withDetail(event.stage, event.detail);
    case 'delivery_finished':
      return event.prUrl;
    case 'delivery_failed':
      return event.detail;
    case 'usage_recorded': {
      const cost =
        event.costUsd === undefined ? '' : ` ($${event.costUsd.toFixed(4)})`;
      return `${event.model} ${event.inputTokens}+${event.outputTokens} tok${cost}`;
    }
    case 'job_claimed':
      return `job ${shortId(event.jobId)} ${event.kind} on ${event.cellId}`;
    case 'job_lost':
      return event.reason;
    case 'resumed': {
      const mode =
        event.mode.kind === 'restart_from'
          ? `restart_from ${event.mode.stationId}`
          : event.mode.kind;
      return `${mode} by ${event.by}`;
    }
    case 'reopened':
      return `${event.stationId} by ${event.by}`;
    case 'question_asked':
      return `question ${shortId(event.questionId)}: ${event.text}`;
    case 'question_answered':
      return `question ${shortId(event.questionId)} answered by ${event.by}: ${event.text}`;
    case 'question_abandoned':
      return `question ${shortId(event.questionId)} abandoned`;
    case 'priority_changed':
      return `priority ${event.priority}`;
    case 'cancelled':
      return `reason: ${event.reason}`;
    case 'nudged':
      return event.text;
    case 'note_left':
      return `to ${String(event.to)}`;
    case 'andon_raised':
      return `${event.reason}: ${event.detail}`;
    case 'incident_recorded':
      return `incident ${shortId(event.incidentId)} ${event.action.kind} by ${event.by}: ${event.outcome}`;
    default:
      return '';
  }
};

/** One Traveler line: the clock dimmed, the sequence, the event type in its family colour, the summary. */
export const renderEventLine = (stored: StoredEvent, paint: Paint): string => {
  const clock = paint.dim(formatClock(stored.at));
  const seq = paint.dim(String(stored.seq).padStart(4));
  const type = paintFamily(
    paint,
    familyOf(stored.event.type),
    stored.event.type.padEnd(20),
  );
  return `${clock} ${seq} ${type} ${describeEvent(stored.event)}`.trimEnd();
};

/** The whole Traveler of a Work order, one line per event, oldest first. */
export const renderTraveler = (events: StoredEvent[], paint: Paint): string =>
  events.map((stored) => renderEventLine(stored, paint)).join('\n');
