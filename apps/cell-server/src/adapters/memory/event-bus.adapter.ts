import type {
  BusListener,
  EventBusPort,
} from '../../application/ports/event-bus.port';

export const createEventBus = (): EventBusPort => {
  const listeners = new Set<BusListener>();
  return {
    publish: (event) => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
