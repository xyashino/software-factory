import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CLI_CONTRACTS = new URL('../../../src/contracts/', import.meta.url);
const OPERATOR_DOCS = new URL(
  '../../../../operator/docs/PLAN.md',
  import.meta.url,
);

const PAIRS: ReadonlyArray<readonly [string, URL]> = [
  ['operator.contract.ts', OPERATOR_DOCS],
];

const FIELD_NAME = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/g;

const fieldNames = (source: string): Set<string> =>
  new Set(Array.from(source.matchAll(FIELD_NAME), (match) => match[1]));

const mentions = (source: string, name: string): boolean =>
  new RegExp(`\\b${name}\\b`).test(source);

describe('CLI contract drift', () => {
  it.each(PAIRS)(
    'keeps every field of %s present in the server source',
    (cliFile, serverFile) => {
      // Arrange
      const cliSource = readFileSync(new URL(cliFile, CLI_CONTRACTS), 'utf8');
      const serverSource = readFileSync(serverFile, 'utf8');

      // Act
      const missing = [...fieldNames(cliSource)].filter(
        (name) => !mentions(serverSource, name),
      );

      // Assert
      expect(missing).toEqual([]);
    },
  );
});
