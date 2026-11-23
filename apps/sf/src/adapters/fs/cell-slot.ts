import { resolve } from 'node:path';
import { CELLS_DIR, cellPidNameOf } from '../../config';
import { createPidFile } from './pid-file';

const cellsDirOf = (cwd: string): string => resolve(cwd, CELLS_DIR);
const slotOf = (name: string) => createPidFile(cellPidNameOf(name));

export const claimCellSlot = (cwd: string, name: string): Promise<boolean> =>
  slotOf(name).acquire(cellsDirOf(cwd), process.pid);

export const releaseCellSlot = (cwd: string, name: string): Promise<void> =>
  slotOf(name).remove(cellsDirOf(cwd));
