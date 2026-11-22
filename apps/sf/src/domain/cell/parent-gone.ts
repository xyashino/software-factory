export const parentGoneOf = (
  expectedPid: number,
  currentPpid: number,
): boolean => currentPpid !== expectedPid;
