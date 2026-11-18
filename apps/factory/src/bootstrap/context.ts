import type { Ports } from '../application/core/procedure';

export type Mode = 'supervisor' | 'cell' | 'operator';

const notWired = (): never => {
  throw new Error('port not wired');
};

export const buildContext = (): Ports => ({
  server: { call: notWired, stream: notWired },
  fs: {
    readText: notWired,
    writeText: notWired,
    exists: notWired,
    readStdin: notWired,
  },
  tokens: { read: notWired, write: notWired, clear: notWired },
  operator: { open: notWired, close: notWired },
  runner: { start: notWired, abort: notWired, wait: notWired },
  git: { currentBranch: notWired, isClean: notWired },
  process: { run: notWired },
  clock: { now: notWired },
});
