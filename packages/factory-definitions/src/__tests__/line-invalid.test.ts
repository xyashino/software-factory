import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DefinitionError } from '../errors';
import { parseLine } from '../line-schema';
import { validateLine } from '../line-validate';
import { readDefinitions } from '../load';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const VALID = join(
  import.meta.dirname,
  'fixtures',
  'valid',
  'lines',
  'feature.yml',
);
const FILE = 'lines/feature.yml';

const operators = readDefinitions(PACKAGE_ROOT).definitions.operators;
const validText = readFileSync(VALID, 'utf8');

/** The valid fixture with one edit. The edited text must occur exactly once. */
const mutate = (from: string, to: string): string => {
  if (validText.split(from).length !== 2) {
    throw new Error(`fixture edit must match exactly once: ${from}`);
  }
  return validText.replace(from, () => to);
};

/** Every problem in a Line: schema problems when the file does not parse, cross-file ones otherwise. */
const problemsOf = (text: string): DefinitionError[] => {
  const parsed = parseLine({ file: FILE, path: VALID }, text);
  if (!parsed.ok) return parsed.error;
  return validateLine(FILE, parsed.value, operators);
};

type Case = [
  name: string,
  edit: [string, string],
  field: string,
  message: RegExp,
];

const schemaCases: Case[] = [
  [
    'rejects an unknown top-level key',
    ['name: feature\n', 'name: feature\ncolour: red\n'],
    'colour',
    /unknown key/,
  ],
  [
    'rejects the v1 top-level operator block',
    [
      'deliver:\n',
      'operator:\n  profile: planner\n  runner: claude\n  model: sonnet\n  timeout: 20m\ndeliver:\n',
    ],
    'operator',
    /no top-level operator block/,
  ],
  [
    'requires schemaVersion',
    ['schemaVersion: 2\n', ''],
    'schemaVersion',
    /must be 2|is required/,
  ],
  [
    'rejects a duration with a decimal',
    ['timeout: 2m', 'timeout: 1.5m'],
    'workspace.sync.timeout',
    /duration/,
  ],
  [
    'rejects an unknown runner',
    [
      '    runner: claude\n    model: sonnet',
      '    runner: gpt\n    model: sonnet',
    ],
    'operators.planner.runner',
    /must be one of/,
  ],
  [
    'rejects a requires tag that is not a lowercase tag',
    ['requires: [docker]', 'requires: [Docker!]'],
    'stations[1].requires[0]',
    /lowercase tag/,
  ],
  [
    'rejects onFail.max 0',
    ['max: 3', 'max: 0'],
    'stations[2].onFail.max',
    /from 1 to 5/,
  ],
  [
    'rejects onFail.max 6',
    ['max: 2', 'max: 6'],
    'stations[3].onFail.max',
    /from 1 to 5/,
  ],
  [
    'rejects maxRestarts out of range',
    ['requires: [docker]', 'requires: [docker]\n    maxRestarts: 101'],
    'stations[1].maxRestarts',
    /from 0 to 100/,
  ],
  [
    'rejects an unknown key inside a station',
    ['requires: [docker]', 'requires: [docker]\n    colour: red'],
    'stations[1].colour',
    /unknown key/,
  ],
  [
    'rejects a station id that is reserved',
    ['- id: plan', '- id: operator'],
    'stations[0].id',
    /reserved/,
  ],
  [
    'rejects a machine-local path in a workspace command',
    ['- git fetch origin', '- git fetch /home/dev/repo'],
    'workspace.sync.exec[0]',
    /machine-local/,
  ],
  [
    'rejects a machine-local path in an inspection command',
    ['- pnpm test', '- cat /home/dev/build.log'],
    'stations[2].exec[0]',
    /machine-local/,
  ],
];

const crossFileCases: Case[] = [
  [
    'rejects a name that is not the file name',
    ['name: feature', 'name: other'],
    'name',
    /must equal the file name "feature"/,
  ],
  [
    'rejects a station that names no operator',
    ['operator: planner', 'operator: ghost'],
    'stations[0].operator',
    /unknown operator "ghost"/,
  ],
  [
    'rejects an operator pool with no profile file',
    ['profile: planner', 'profile: ghost'],
    'operators.planner.profile',
    /unknown profile "ghost"/,
  ],
  [
    'rejects a retry target that comes later',
    ['retry: build\n      max: 3', 'retry: audit\n      max: 3'],
    'stations[2].onFail.retry',
    /must be an earlier station/,
  ],
  [
    'rejects a retry target that names no station',
    ['retry: build\n      max: 3', 'retry: nowhere\n      max: 3'],
    'stations[2].onFail.retry',
    /unknown station "nowhere"/,
  ],
  [
    'rejects a retry target that is an inspection',
    ['retry: build\n      max: 2', 'retry: quality-gate\n      max: 2'],
    'stations[3].onFail.retry',
    /is an inspection/,
  ],
  [
    'rejects onFail on a station whose profile does not judge',
    [
      'requires: [docker]',
      'requires: [docker]\n    onFail:\n      retry: plan\n      max: 1',
    ],
    'stations[1].onFail',
    /only a judging profile/,
  ],
  [
    'rejects a duplicate station id',
    ['- id: audit', '- id: build'],
    'stations[3].id',
    /duplicate station id "build"/,
  ],
  [
    'rejects an input the producer does not declare',
    ['- plan.plan', '- plan.notes'],
    'stations[1].inputs[0]',
    /does not produce artifact "notes"/,
  ],
  [
    'rejects a gate input that names an operator station',
    ['- quality-gate.gate', '- build.gate'],
    'stations[3].inputs[1]',
    /needs an inspection/,
  ],
  [
    'rejects an operator pool no station uses',
    [
      'stations:\n',
      '  spare:\n    profile: planner\n    runner: claude\n    model: sonnet\n    timeout: 1m\nstations:\n',
    ],
    'operators.spare',
    /is not used by any station/,
  ],
  [
    'rejects a deliver ref to an unknown station',
    ['commit: build.commit', 'commit: ghost.commit'],
    'deliver.commit',
    /unknown station "ghost"/,
  ],
];

describe('line problems, each with file and field', () => {
  it.each(schemaCases)('%s', (_name, [from, to], field, message) => {
    expect(problemsOf(mutate(from, to))).toContainEqual(
      expect.objectContaining({
        file: FILE,
        field,
        message: expect.stringMatching(message),
      }),
    );
  });

  it.each(crossFileCases)('%s', (_name, [from, to], field, message) => {
    expect(problemsOf(mutate(from, to))).toContainEqual(
      expect.objectContaining({
        file: FILE,
        field,
        message: expect.stringMatching(message),
      }),
    );
  });

  it('reports every problem of a broken file, not just the first', () => {
    const text = mutate('max: 3', 'max: 0').replace('max: 2', 'max: 6');
    const fields = problemsOf(text).map((error) => error.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'stations[2].onFail.max',
        'stations[3].onFail.max',
      ]),
    );
  });
});
