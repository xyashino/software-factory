import type { StateTransitionRecord } from '../../domain/common/events';

export type TransitionListener = (transition: StateTransitionRecord) => void;

export type TransitionBusPort = {
  publish(transitions: readonly StateTransitionRecord[]): void;
  subscribe(listener: TransitionListener): () => void;
};
