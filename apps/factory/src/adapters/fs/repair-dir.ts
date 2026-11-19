import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPAIRS_DIR = 'repairs';
const BIN_DIR = 'bin';
const PROMPT_FILE = 'prompt.md';
const SHIM_NAME = 'factory-operator';
const SHIM_MODE = 0o755;
const HASH_LENGTH = 16;

export interface RepairDirInput {
  prompt: string;
  bun: string;
  operatorCli: string;
}

export interface RepairDir {
  promptPath: string;
  binDir: string;
}

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

export const repairDirOf = (cellDataDir: string, jobId: string): string =>
  join(
    cellDataDir,
    REPAIRS_DIR,
    createHash('sha256').update(jobId).digest('hex').slice(0, HASH_LENGTH),
  );

export const prepareRepairDir = (
  dir: string,
  input: RepairDirInput,
): RepairDir => {
  const binDir = join(dir, BIN_DIR);
  mkdirSync(binDir, { recursive: true });
  const promptPath = join(dir, PROMPT_FILE);
  writeFileSync(promptPath, input.prompt);
  const shim = join(binDir, SHIM_NAME);
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${shellQuote(input.bun)} ${shellQuote(input.operatorCli)} "$@"\n`,
  );
  chmodSync(shim, SHIM_MODE);
  return { promptPath, binDir };
};
