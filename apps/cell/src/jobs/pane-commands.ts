import { fileURLToPath } from 'node:url';

/** The command the task's `logs` tab runs: the Traveler of its Work order, followed (`factory log -f`). */
export const logCommandOf = (orderId: string): string => {
  const cli = fileURLToPath(
    new URL('../../../cli/src/cli.ts', import.meta.url),
  );
  return `"${process.execPath}" "${cli}" log "${orderId}" -f`;
};
