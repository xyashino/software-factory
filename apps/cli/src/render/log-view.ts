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
  inspection_finished: 'cycle',
  cycle_failed: 'cycle',
  cycle_blocked: 'cycle',
  cycle_handed_over: 'cycle',
  usage_recorded: 'cycle',
  note_left: 'cycle',
  nudged: 'cycle',
  andon_raised: 'andon',
  resumed: 'andon',
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

/** What an event says, in a few words, with ids shortened. */
export const describeEvent = (event: StoredEvent['event']): string => {
  switch (event.type) {
    case 'cycle_started':
      return `cycle ${shortId(event.cycleId)} station ${event.stationId} n=${event.n}`;
    case 'cycle_completed':
      return `cycle ${shortId(event.cycleId)} committed ${event.commit.slice(0, 8)}`;
    case 'cycle_failed':
    case 'cycle_blocked':
    case 'cycle_handed_over':
      return `cycle ${shortId(event.cycleId)}`;
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
