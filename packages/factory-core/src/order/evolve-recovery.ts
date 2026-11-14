import type { OrderEvent } from './events';
import type { WorkOrderState } from './state';

type Recovered = Extract<OrderEvent, { type: 'order_recovered' }>;

/**
 * Folds `order_recovered` (CORE §4.3 rule 11). The passed Stations are a prefix of the Line, so the
 * next Station is the one at `passedStations.length`. `lastPassed` stays empty on purpose: no Cycle
 * exists for a recovered Station.
 */
export const applyRecovered = (
  state: WorkOrderState,
  ev: Recovered,
): WorkOrderState => {
  const next: WorkOrderState = {
    ...state,
    recovered: [...ev.passedStations],
    checkpoint: { ...ev.checkpoint },
    resumedWaiting: false,
  };
  if (ev.delivery) {
    return {
      ...next,
      phase: { kind: 'delivered' },
      delivery: { ...ev.delivery },
    };
  }
  if (ev.passedStations.length >= state.line.stations.length) {
    return { ...next, phase: { kind: 'delivering' } };
  }
  return {
    ...next,
    phase: { kind: 'stations', index: ev.passedStations.length },
  };
};
