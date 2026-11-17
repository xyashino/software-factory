import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { ageOf, paintHolder, paintStatus } from './board';
import type { Paint } from './paint';
import { shortId } from './log-view';

type OrderDetail = RouteResponse<'orderDetail'>;

/**
 * The question a Supervisor may answer: the latest one not yet answered. An abandoned
 * question that no one answered is still answerable, so only an answer closes it here.
 */
export const openQuestionOf = (
  events: readonly StoredEvent[],
): { questionId: string; text: string } | undefined => {
  const open = new Map<string, string>();
  for (const stored of events) {
    const event = stored.event;
    if (event.type === 'question_asked') {
      open.set(event.questionId, event.text);
    } else if (event.type === 'question_answered') {
      open.delete(event.questionId);
    }
  }
  const last = [...open.entries()].at(-1);
  return last ? { questionId: last[0], text: last[1] } : undefined;
};

/** The Cycles of a Work order, each with the event that ended it, if any. */
/**
 * The incidents of a Work order, oldest first: what the Mechanic or the Supervisor did
 * about each Andon, with each file or config it changed and the commit or blob that holds it.
 */
export const incidentsOf = (events: readonly StoredEvent[]): string[] =>
  events.flatMap(({ event }) => {
    if (event.type !== 'incident_recorded') return [];
    const head = `incident ${shortId(event.incidentId)}  ${event.andonReason}  ${event.action.kind} by ${event.by}`;
    const changes = event.changes.map(
      (change) => `  ${change.kind} ${change.path} = ${change.ref}`,
    );
    return [
      head,
      `  diagnosis ${event.diagnosis}`,
      ...changes,
      `  outcome   ${event.outcome}`,
    ];
  });

/**
 * The outcome of each Cycle of a Work order, in start order. A Cycle is `running` until an event ends
 * it: a recorded verdict (`verdict_recorded`) or inspection (`inspection_finished`) ends a review
 * station with `passed` or `failed`; the `cycle_*` events end any Cycle with their own outcome.
 */
export const cyclesOf = (
  events: readonly StoredEvent[],
): Array<{ cycleId: string; station: string; n: number; end: string }> => {
  const cycles = new Map<
    string,
    { cycleId: string; station: string; n: number; end: string }
  >();
  const end = (cycleId: string, outcome: string): void => {
    const cycle = cycles.get(cycleId);
    if (cycle) cycles.set(cycleId, { ...cycle, end: outcome });
  };
  for (const stored of events) {
    const event = stored.event;
    if (event.type === 'cycle_started') {
      cycles.set(event.cycleId, {
        cycleId: event.cycleId,
        station: event.stationId,
        n: event.n,
        end: 'running',
      });
    } else if (event.type === 'verdict_recorded') {
      end(event.cycleId, event.pass ? 'passed' : 'failed');
    } else if (event.type === 'inspection_finished') {
      end(event.cycleId, event.passed ? 'passed' : 'failed');
    } else if (event.type === 'cycle_completed') {
      end(event.cycleId, 'passed');
    } else if (event.type === 'cycle_failed') {
      end(event.cycleId, 'failed');
    } else if (event.type === 'cycle_blocked') {
      end(event.cycleId, 'blocked');
    } else if (event.type === 'cycle_handed_over') {
      end(event.cycleId, 'handed_over');
    }
  }
  return [...cycles.values()];
};

/**
 * The copy-pasteable next commands for a Work order in its current state (`factory show`). Empty for
 * a delivered or merged Work order, which has nothing left for the Supervisor to do.
 */
export const actionsOf = (order: OrderDetail['order']): string[] => {
  const id = order.orderId;
  switch (order.status) {
    case 'andon':
      return [
        `factory resume ${id}`,
        `factory resume ${id} --from <station> --note "..."`,
        `factory cancel ${id} --reason "..."`,
      ];
    case 'waiting_answer':
      return [
        `factory answer ${id} "..."`,
        `factory cancel ${id} --reason "..."`,
      ];
    case 'cancelled':
      return [`factory reopen ${id}`];
    case 'queued':
      return [
        `factory prio ${id} <high|medium|low>`,
        `factory cancel ${id} --reason "..."`,
      ];
    case 'delivered':
    case 'merged':
      return [];
    default:
      return [`factory cancel ${id} --reason "..."`];
  }
};

/**
 * The Work order detail (`factory show`): the board row, the open question, the Andon
 * reason and the Cycles. Stored text is printed as it is; only the labels and the status are coloured.
 */
export const renderOrder = (
  detail: OrderDetail,
  paint: Paint,
  now: number,
): string => {
  const { order, events } = detail;
  const lines = [
    `${paint.bold(order.orderId)}  ${order.title}`,
    `status    ${paintStatus(paint, order.status)}`,
    `holder    ${paintHolder(paint, order.holder)}`,
    `priority  ${order.priority}`,
    `line      ${order.line}`,
    `station   ${order.stationId ?? '-'}`,
    `pr        ${order.prUrl ?? '-'}${order.prState ? ` (${order.prState})` : ''}`,
    `age       ${ageOf(order.updatedAt, now)}`,
  ];
  if (order.andonReason) lines.push(`andon     ${order.andonReason}`);
  const question = openQuestionOf(events);
  if (question) {
    lines.push(`question  ${shortId(question.questionId)}: ${question.text}`);
  }
  const cycles = cyclesOf(events).map(
    (cycle) =>
      `  #${cycle.n} ${cycle.station.padEnd(12)} ${shortId(cycle.cycleId)}  ${cycle.end}`,
  );
  if (cycles.length > 0) {
    lines.push('cycles', ...cycles);
  }
  const incidents = incidentsOf(events);
  if (incidents.length > 0) {
    lines.push('incidents', ...incidents);
  }
  const actions = actionsOf(order);
  if (actions.length > 0) {
    lines.push('actions', ...actions.map((action) => `  ${action}`));
  }
  return lines.join('\n');
};
