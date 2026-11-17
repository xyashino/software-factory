import { err, ok } from '../result';
import type { CommandOf, DecideContext } from './commands';
import {
  type Decision,
  invalidIf,
  precondition,
  refuseIfTerminal,
  requireActor,
} from './decide-guards';
import type { OrderEvent } from './events';
import type { WorkOrderState } from './state';

/**
 * Rebuilds a fresh Work order from git. Only the factory may run it, and only
 * before any job was claimed: after that the Work order's progress is in its own events, and a second
 * recovery would overwrite it. `passedStations` must be a prefix of the pinned Line, and a `delivery`
 * means every Station passed, since the PR was opened from the finished Line.
 */
export const recoverOrder = (
  state: WorkOrderState,
  command: CommandOf<'RecoverOrder'>,
  ctx: DecideContext,
): Decision => {
  const denied = requireActor(ctx, ['factory']) ?? refuseIfTerminal(state);
  if (denied) return err(denied);
  if (state.epoch > 0 || state.cycles.length > 0) {
    return err(
      precondition('a job was claimed, so the Work order is not fresh'),
    );
  }
  if (state.recovered.length > 0) {
    return err(precondition('the Work order was already recovered'));
  }
  const stations = state.line.stations.map((station) => station.id);
  const passed = command.passedStations;
  const issues: string[] = [];
  if (passed.length > stations.length) {
    issues.push('passedStations is longer than the Line');
  }
  passed.forEach((id, index) => {
    if (stations[index] !== id) {
      issues.push(
        `passedStations[${index}] is ${id}, not the Line's ${stations[index]}`,
      );
    }
  });
  const last = passed.at(-1) ?? null;
  if (command.checkpoint.afterStation !== last) {
    issues.push('checkpoint.afterStation is not the last passed Station');
  }
  if (command.delivery !== undefined && passed.length !== stations.length) {
    issues.push('a delivered Work order must have every Station passed');
  }
  const problem = invalidIf(issues);
  if (problem) return err(problem);

  const events: OrderEvent[] = [
    {
      type: 'order_recovered',
      passedStations: [...passed],
      checkpoint: { ...command.checkpoint },
      ...(command.delivery === undefined
        ? {}
        : { delivery: { ...command.delivery } }),
    },
  ];
  return ok(events);
};
