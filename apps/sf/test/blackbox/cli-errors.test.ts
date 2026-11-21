import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const EXIT_ARGUMENT = 2;
const STACK_MARKERS = [
  'at runCommand',
  '/$bunfs/',
  'CLIError:',
  'code: "E_',
  'at async',
];

const UNKNOWN_PARENTS: string[][] = [
  [],
  ['cell'],
  ['server'],
  ['server', 'token'],
  ['operator'],
  ['operator', 'verdict'],
  ['incident'],
  ['queue'],
  ['order'],
  ['project'],
  ['todos'],
  ['token'],
  ['web'],
];

const BARE_GROUPS: string[][] = [
  ['cell'],
  ['server'],
  ['server', 'token'],
  ['operator'],
  ['operator', 'verdict'],
  ['order'],
  ['project'],
  ['todos'],
  ['token'],
  ['web'],
];

const MISSING_FLAGS: string[][] = [
  ['cell', 'stop'],
  ['cell', 'revoke'],
  ['project', 'add', 'foo'],
  ['token', 'create'],
];

const runSf = (args: string[]) =>
  spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

const expectCleanFailure = (args: string[]): void => {
  // Act
  const result = runSf(args);

  // Assert
  expect(result.status).toBe(EXIT_ARGUMENT);
  expect(result.stdout).toContain('USAGE');
  expect(result.stderr.trim()).not.toBe('');
  for (const marker of STACK_MARKERS) {
    expect(result.stderr).not.toContain(marker);
    expect(result.stdout).not.toContain(marker);
  }
};

describe('sf unknown command', () => {
  it.each(UNKNOWN_PARENTS)(
    'fails cleanly for unknown under %s',
    (...parents) => {
      expectCleanFailure([...parents, 'sasda']);
    },
  );

  it('names the unknown command', () => {
    // Act
    const result = runSf(['cell', 'sasda']);

    // Assert
    expect(result.stderr).toContain('sasda');
  });
});

describe('sf bare group', () => {
  it.each(BARE_GROUPS)('fails cleanly for bare %s', (...group) => {
    expectCleanFailure(group);
  });
});

describe('sf missing required flag', () => {
  it.each(MISSING_FLAGS)('fails cleanly for %s', (...args) => {
    expectCleanFailure(args);
  });
});
