const DURATION = /^([1-9][0-9]*)(s|m|h)$/;

const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
} as const;

/**
 * Parses a human duration such as `30s`, `20m` or `1h` into milliseconds.
 * Returns null for anything else: zero, negatives, decimals, unitless numbers.
 */
export const parseDuration = (input: string): number | null => {
  const match = DURATION.exec(input);
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 's' || unit === 'm' || unit === 'h') {
    return amount * UNIT_MS[unit];
  }
  return null;
};
