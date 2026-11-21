import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CELLS_DIR,
  LEGACY_CELL_STATE_PATH,
  cellPidNameOf,
  cellStatePathOf,
} from '../../config';
import { createPidFile } from './pid-file';

const CELL_STATE_MODE = 0o600;

const cellsDirOf = (cwd: string): string => resolve(cwd, CELLS_DIR);
const slotOf = (name: string) => createPidFile(cellPidNameOf(name));

export const claimCellSlot = (cwd: string, name: string): Promise<boolean> =>
  slotOf(name).acquire(cellsDirOf(cwd), process.pid);

export const releaseCellSlot = (cwd: string, name: string): Promise<void> =>
  slotOf(name).remove(cellsDirOf(cwd));

export const migrateLegacyCellState = (cwd: string, name: string): boolean => {
  const legacy = resolve(cwd, LEGACY_CELL_STATE_PATH);
  const target = resolve(cwd, cellStatePathOf(name));
  if (!existsSync(legacy) || existsSync(target)) {
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(legacy, target);
  chmodSync(target, CELL_STATE_MODE);
  return true;
};
