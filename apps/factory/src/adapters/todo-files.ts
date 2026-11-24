import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArgumentError } from '../errors';
import type { TodoFilesPort } from '../ports';

const TODO_EXTENSION = '.md';

export const createTodoFilesAdapter = (): TodoFilesPort => ({
  list: async (dir) => {
    if (!existsSync(dir)) {
      throw new ArgumentError(`todo directory ${dir} not found`);
    }
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(TODO_EXTENSION))
      .map((entry) => entry.name)
      .sort()
      .map((filename) => ({
        filename,
        text: readFileSync(join(dir, filename), 'utf8'),
      }));
  },
});
