import { readFileSync } from 'node:fs';
import { ArgumentError } from '../../application/core/errors';

const STDIN_MARK = '-';
const nodeIo: OperatorFileIo = {
  readFile: (path) => readFileSync(path, 'utf8'),
  readStdin: () => readFileSync(0, 'utf8'),
};

export interface OperatorFileIo {
  readFile(path: string): string;
  readStdin(): string;
}

export const readOperatorFile = (
  path: string,
  flag: string,
  io: OperatorFileIo = nodeIo,
): string => {
  try {
    return path === STDIN_MARK ? io.readStdin() : io.readFile(path);
  } catch {
    throw new ArgumentError(
      path === STDIN_MARK
        ? `${flag} cannot read stdin`
        : `${flag} file ${path} cannot be read`,
    );
  }
};
