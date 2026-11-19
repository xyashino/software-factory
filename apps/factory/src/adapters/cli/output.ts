export const printLine = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export const printError = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const printJson = (value: unknown): void => {
  printLine(JSON.stringify(value));
};
