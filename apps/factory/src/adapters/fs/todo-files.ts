import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ArgumentError } from '../../application/core/errors';
import type {
  TodoFile,
  TodoFilesPort,
  WriteOutcome,
} from '../../application/ports/todo-files.port';

const TODO_SUFFIX = '.md';

const isExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

export const createTodoFiles = (): TodoFilesPort => ({
  list: async (dir): Promise<TodoFile[]> => {
    if (!existsSync(dir)) {
      throw new ArgumentError(`todos directory not found: ${dir}`);
    }
    return readdirSync(dir)
      .filter((name) => name.endsWith(TODO_SUFFIX))
      .sort()
      .map((filename) => ({
        filename,
        text: readFileSync(join(dir, filename), 'utf8'),
      }));
  },
  write: async (dir, filename, text, force): Promise<WriteOutcome> => {
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, filename), text, {
        flag: force ? 'w' : 'wx',
      });
      return 'written';
    } catch (error) {
      if (isExistsError(error)) {
        return 'refused';
      }
      throw error;
    }
  },
});
