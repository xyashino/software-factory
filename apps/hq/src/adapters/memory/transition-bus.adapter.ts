import type {
  TransitionBusPort,
  TransitionListener,
} from '../../application/ports/transition-bus.port';

export const createTransitionBus = (): TransitionBusPort => {
  const listeners = new Set<TransitionListener>();
  return {
    publish: (transitions) => {
      for (const transition of transitions) {
        for (const listener of listeners) listener(transition);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
