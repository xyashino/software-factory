import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ArgumentError } from '../../application/core/errors';
import type {
  CellSession,
  CellStatePort,
} from '../../application/ports/cell-state.port';

const CELL_STATE_MODE = 0o600;

const sessionSchema = z
  .object({
    cellId: z.string().trim().min(1),
    sessionToken: z.string().trim().min(1),
  })
  .strict();

const parseSession = (text: string): CellSession => {
  try {
    return sessionSchema.parse(JSON.parse(text));
  } catch {
    throw new ArgumentError(
      'cell state file is unreadable, remove it to enroll again',
    );
  }
};

export const createMemoryCellState = (): CellStatePort => {
  let session: CellSession | null = null;
  return {
    read: async () => session,
    write: async (next) => {
      session = sessionSchema.parse(next);
    },
  };
};

export const createCellStateFile = (path: string): CellStatePort => ({
  read: async () =>
    existsSync(path) ? parseSession(readFileSync(path, 'utf8')) : null,
  write: async (session) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(sessionSchema.parse(session))}\n`, {
      mode: CELL_STATE_MODE,
    });
    chmodSync(path, CELL_STATE_MODE);
  },
});
