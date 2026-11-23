export const findDependencyCycle = (
  parentOf: ReadonlyMap<string, string | null>,
): string | null => {
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined) {
      if (seen.has(current)) return current;
      seen.add(current);
      current = parentOf.get(current);
    }
  }
  return null;
};
