import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Refused } from '../../application/core/errors';
import type { LocalSlotStorePort } from '../../application/ports/local-slot-store.port';
import { LocalSlotsSchema, type LocalSlot } from '../../domain/cell/local-slot';

const SLOTS_FILE = 'slots.json';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const PID_SUFFIX = '.pid';
const LOG_SUFFIX = '.log';

const parseFile = (path: string): LocalSlot[] => {
  if (!existsSync(path)) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Refused(`local slot store ${path} is not valid JSON`);
  }
  const parsed = LocalSlotsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Refused(`local slot store ${path} has an invalid shape`);
  }
  return parsed.data;
};

const writeAtomic = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const staging = `${path}.tmp-${process.pid}`;
  writeFileSync(staging, text, { mode: FILE_MODE });
  chmodSync(staging, FILE_MODE);
  renameSync(staging, path);
};

export const createLocalSlotStore = (dir: string): LocalSlotStorePort => {
  const slotsPath = join(dir, SLOTS_FILE);
  const pathOf = (slotId: string, suffix: string): string =>
    join(dir, `${slotId}${suffix}`);
  return {
    read: async () => parseFile(slotsPath),
    write: async (slots) => {
      writeAtomic(
        slotsPath,
        `${JSON.stringify(LocalSlotsSchema.parse(slots), null, 2)}\n`,
      );
      for (const slot of slots) {
        if (slot.pid === null) {
          rmSync(pathOf(slot.slotId, PID_SUFFIX), { force: true });
        } else {
          writeAtomic(pathOf(slot.slotId, PID_SUFFIX), `${slot.pid}\n`);
        }
      }
    },
    remove: async (slotId) => {
      const remaining = parseFile(slotsPath).filter(
        (slot) => slot.slotId !== slotId,
      );
      writeAtomic(
        slotsPath,
        `${JSON.stringify(LocalSlotsSchema.parse(remaining), null, 2)}\n`,
      );
      rmSync(pathOf(slotId, PID_SUFFIX), { force: true });
      rmSync(pathOf(slotId, LOG_SUFFIX), { force: true });
    },
    logPathOf: (slotId) => pathOf(slotId, LOG_SUFFIX),
  };
};
