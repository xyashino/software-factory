export interface DrainState {
  draining: boolean;
  force: boolean;
  left: boolean;
  superseded: boolean;
}

export const drainStateOf = (): DrainState => ({
  draining: false,
  force: false,
  left: false,
  superseded: false,
});

export const observeDrain = (
  state: DrainState,
  signals: readonly string[],
): void => {
  if (signals.includes('drain')) state.draining = true;
  if (signals.includes('force')) state.force = true;
};
