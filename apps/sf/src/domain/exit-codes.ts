export const EXIT = {
  ok: 0,
  refused: 1,
  argument: 2,
  unreachable: 3,
  preflight: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
