export const BACKOFF_MS_CEILING = 60_000;

export const assertCount = (count: number, max: number): void => {
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError('count must be an integer of at least 1');
  if (count > max) throw new RangeError(`count must not exceed ${max}`);
};

export const allocateSlotNames = (
  host: string,
  count: number,
  taken: readonly string[],
): string[] => {
  const used = new Set(taken);
  const names: string[] = [];
  for (let suffix = 1; names.length < count; suffix++) {
    const candidate = suffix === 1 ? host : `${host}-${suffix}`;
    if (used.has(candidate)) continue;
    used.add(candidate);
    names.push(candidate);
  }
  return names;
};

export const nextBackoffMs = (
  attempt: number,
  baseMs: number,
  maxMs: number = BACKOFF_MS_CEILING,
): number => Math.min(baseMs * 2 ** attempt, maxMs);
