import type { RunResult } from '../../bootstrap/run';
import { EXIT } from '../../domain/exit-codes';

export const printLine = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export const printError = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const printJson = (value: unknown): void => {
  printLine(JSON.stringify(value));
};

const padRow = (cells: string[], widths: number[]): string =>
  cells
    .map((text, index) => text.padEnd(widths[index] ?? 0))
    .join('  ')
    .trimEnd();

export const printTable = (headers: string[], rows: string[][]): void => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  printLine(padRow(headers, widths));
  for (const row of rows) {
    printLine(padRow(row, widths));
  }
};

export const reportFailure = <O>(result: RunResult<O>): number => {
  if (result.kind === 'ok') {
    return EXIT.ok;
  }
  printError(result.message);
  return result.exitCode;
};
