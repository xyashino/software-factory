import type { ArgsDef } from 'citty';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import {
  assertValidArgs,
  parsePort,
  parseWholeNumber,
  requiredPositional,
} from '../../../src/adapters/cli/validate';

const DEFS: ArgsDef = {
  id: { type: 'string', alias: 'i' },
  'base-branch': { type: 'string' },
  json: { type: 'boolean', default: false },
};

const POSITIONAL_DEFS: ArgsDef = {
  name: { type: 'positional', required: true },
  json: { type: 'boolean', default: false },
};

const VARIADIC_DEFS: ArgsDef = {
  orders: { type: 'positional', valueHint: 'order-id...' },
};

const messageOf = (attempt: () => unknown): string => {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(ArgumentError);
    return (error as Error).message;
  }
  return '';
};

describe('assertValidArgs unknown options', () => {
  it('accepts declared flags, aliases and both name spellings', () => {
    // Arrange
    const args = ['--id', 'a', '-i', 'b', '--baseBranch', 'x', '--json'];

    // Act
    const message = messageOf(() => assertValidArgs(DEFS, args));

    // Assert
    expect(message).toBe('');
  });

  it('refuses an undeclared long flag', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--bogus']));

    // Assert
    expect(message).toBe('unknown option --bogus');
  });

  it('refuses an undeclared short flag', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['-z']));

    // Assert
    expect(message).toBe('unknown option -z');
  });

  it('refuses an undeclared flag given with =value', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--bogus=1']));

    // Assert
    expect(message).toBe('unknown option --bogus=1');
  });

  it('names the unknown flag before a missing value', () => {
    // Act
    const message = messageOf(() =>
      assertValidArgs(DEFS, ['--id', '--bogus', 'x']),
    );

    // Assert
    expect(message).toBe('unknown option --bogus');
  });

  it('ignores everything after --', () => {
    // Act
    const message = messageOf(() =>
      assertValidArgs(POSITIONAL_DEFS, ['a', '--', '--bogus']),
    );

    // Assert
    expect(message).toBe('unexpected argument --bogus');
  });

  it('accepts --no-<flag> for a boolean', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--no-json']));

    // Assert
    expect(message).toBe('');
  });
});

describe('assertValidArgs flag values', () => {
  it.each([
    [['--id']],
    [['--id', '--json']],
    [['--id', '']],
    [['--id=']],
    [['-i']],
  ])('refuses a string flag without a value: %j', (args) => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, args));

    // Assert
    expect(message).toMatch(/^(--id|-i) requires a value$/);
  });

  it('accepts a lone dash as a value', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--id', '-']));

    // Assert
    expect(message).toBe('');
  });

  it('accepts a negative number as a value', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--id', '-1']));

    // Assert
    expect(message).toBe('');
  });
});

describe('assertValidArgs positionals', () => {
  it('refuses a stray positional when none is declared', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['extra']));

    // Assert
    expect(message).toBe('unexpected argument extra');
  });

  it('does not count a flag value as a positional', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['--id', 'a']));

    // Assert
    expect(message).toBe('');
  });

  it('refuses positionals beyond the declared ones', () => {
    // Act
    const message = messageOf(() =>
      assertValidArgs(POSITIONAL_DEFS, ['a', 'b']),
    );

    // Assert
    expect(message).toBe('unexpected argument b');
  });

  it('accepts any number for a variadic positional', () => {
    // Act
    const message = messageOf(() =>
      assertValidArgs(VARIADIC_DEFS, ['a', 'b', 'c']),
    );

    // Assert
    expect(message).toBe('');
  });

  it('skips the positional check when asked', () => {
    // Act
    const message = messageOf(() => assertValidArgs(DEFS, ['extra'], false));

    // Assert
    expect(message).toBe('');
  });
});

describe('parseWholeNumber', () => {
  it('reads digits within range', () => {
    // Act
    const value = parseWholeNumber('12', '--max-running', { min: 1 });

    // Assert
    expect(value).toBe(12);
  });

  it.each(['abc', '', '1.5', '-1', '1e3', '0x10'])('refuses %j', (input) => {
    // Act
    const message = messageOf(() =>
      parseWholeNumber(input, '--after', { min: 0 }),
    );

    // Assert
    expect(message).toBe(
      `--after takes a whole number at least 0, not "${input}"`,
    );
  });

  it('refuses a value below the minimum', () => {
    // Act
    const message = messageOf(() =>
      parseWholeNumber('0', '--max-running', { min: 1 }),
    );

    // Assert
    expect(message).toBe(
      '--max-running takes a whole number at least 1, not "0"',
    );
  });
});

describe('parsePort', () => {
  it('accepts the port range ends', () => {
    // Act
    const ports = [parsePort('1', '--port'), parsePort(65_535, '--port')];

    // Assert
    expect(ports).toEqual([1, 65_535]);
  });

  it.each(['0', '65536', 'abc'])('refuses %s', (input) => {
    // Act
    const message = messageOf(() => parsePort(input, 'FACTORY_PORT'));

    // Assert
    expect(message).toBe(
      `FACTORY_PORT takes a whole number between 1 and 65535, not "${input}"`,
    );
  });
});

describe('requiredPositional', () => {
  it.each([undefined, '', '   '])('refuses %j', (input) => {
    // Act
    const message = messageOf(() => requiredPositional(input, 'order id'));

    // Assert
    expect(message).toBe('order id is required');
  });

  it('returns a present value', () => {
    // Act
    const value = requiredPositional('ord-1', 'order id');

    // Assert
    expect(value).toBe('ord-1');
  });
});
