import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { ageOf, paintHolder, paintStatus } from './board';
import type { Paint } from './paint';
import { shortId } from './log-view';

type OrderDetail = RouteResponse<'orderDetail'>;

/**
 * The question a Supervisor may answer: the latest one not yet answered (PROTOCOL §3.1). An abandoned
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
const cyclesOf = (events: readonly StoredEvent[]): string[] => {
  const cycles = new Map<string, { station: string; n: number; end: string }>();
  for (const stored of events) {
    const event = stored.event;
    if (event.type === 'cycle_started') {
      cycles.set(event.cycleId, {
        station: event.stationId,
        n: event.n,
        end: 'running',
      });
    } else if (
      event.type === 'cycle_completed' ||
      event.type === 'cycle_failed' ||
      event.type === 'cycle_blocked' ||
      event.type === 'cycle_handed_over'
    ) {
      const cycle = cycles.get(event.cycleId);
      if (cycle) cycles.set(event.cycleId, { ...cycle, end: event.type });
    }
  }
  return [...cycles.entries()].map(
    ([cycleId, cycle]) =>
      `  #${cycle.n} ${cycle.station.padEnd(12)} ${shortId(cycleId)}  ${cycle.end}`,
  );
};

/**
 * The Work order detail (PROTOCOL §10, `factory show`): the board row, the open question, the Andon
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
  const cycles = cyclesOf(events);
  if (cycles.length > 0) {
    lines.push('cycles', ...cycles);
  }
  return lines.join('\n');
};
