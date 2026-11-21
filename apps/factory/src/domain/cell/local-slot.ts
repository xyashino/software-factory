import { z } from 'zod';

export const LocalSlotSchema = z
  .object({
    slotId: z.string().min(1),
    name: z.string().min(1),
    factory: z.string().min(1),
    repoRoot: z.string().min(1),
    pid: z.number().int().positive().nullable(),
    state: z.enum(['running', 'stopped']),
    createdAt: z.number().int(),
  })
  .strict();

export const LocalSlotsSchema = z.array(LocalSlotSchema);

export type LocalSlot = z.infer<typeof LocalSlotSchema>;

export const findLocalSlot = (
  slots: readonly LocalSlot[],
  id: string,
): LocalSlot | undefined =>
  slots.find((slot) => slot.slotId === id || slot.name === id);

export const allocateLocalNames = (
  base: string,
  count: number,
  taken: readonly string[],
): string[] => {
  const names: string[] = [];
  for (let suffix = 1; names.length < count; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.includes(candidate) && !names.includes(candidate)) {
      names.push(candidate);
    }
  }
  return names;
};
