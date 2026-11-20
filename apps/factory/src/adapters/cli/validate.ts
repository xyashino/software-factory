import type { ArgDef, ArgsDef } from 'citty';
import { ArgumentError } from '../../application/core/errors';

const MAX_PORT = 65_535;
const VARIADIC_HINT = '...';

type Lookup = Map<string, ArgDef>;

interface Option {
  name: string;
  inline: boolean;
  inlineValue: string;
}

interface WholeNumberRange {
  min: number;
  max?: number;
}

const camelOf = (name: string): string =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const kebabOf = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const aliasesOf = (def: ArgDef): string[] => {
  const alias = 'alias' in def ? def.alias : undefined;
  return alias === undefined ? [] : [alias].flat();
};

const lookupOf = (defs: ArgsDef): Lookup => {
  const lookup: Lookup = new Map();
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'positional') {
      continue;
    }
    for (const key of [name, camelOf(name), kebabOf(name), ...aliasesOf(def)]) {
      lookup.set(key, def);
    }
  }
  return lookup;
};

const positionalLimitOf = (defs: ArgsDef): number => {
  const positionals = Object.values(defs).filter(
    (def) => def.type === 'positional',
  );
  return positionals.some((def) => def.valueHint?.endsWith(VARIADIC_HINT))
    ? Number.POSITIVE_INFINITY
    : positionals.length;
};

const optionOf = (token: string): Option | undefined => {
  if (!token.startsWith('-') || token === '-' || /^-\d/.test(token)) {
    return undefined;
  }
  const body = token.replace(/^-{1,2}/, '');
  const equals = body.indexOf('=');
  return equals === -1
    ? { name: body, inline: false, inlineValue: '' }
    : {
        name: body.slice(0, equals),
        inline: true,
        inlineValue: body.slice(equals + 1),
      };
};

const defsOfOption = (
  token: string,
  option: Option,
  lookup: Lookup,
): ArgDef[] | undefined => {
  const direct = lookup.get(option.name);
  if (direct !== undefined) {
    return [direct];
  }
  if (token.startsWith('--')) {
    const negated = option.name.startsWith('no-')
      ? lookup.get(option.name.slice(3))
      : undefined;
    return negated?.type === 'boolean' ? [negated] : undefined;
  }
  const cluster = [...option.name].map((letter) => lookup.get(letter));
  return cluster.every((def) => def !== undefined)
    ? (cluster as ArgDef[])
    : undefined;
};

const takesValue = (def: ArgDef | undefined): boolean =>
  def?.type === 'string' || def?.type === 'enum';

const headOf = (rawArgs: readonly string[]): readonly string[] => {
  const end = rawArgs.indexOf('--');
  return end === -1 ? rawArgs : rawArgs.slice(0, end);
};

const assertKnownOptions = (rawArgs: readonly string[], lookup: Lookup) => {
  for (const token of headOf(rawArgs)) {
    const option = optionOf(token);
    if (option !== undefined && !defsOfOption(token, option, lookup)) {
      throw new ArgumentError(`unknown option ${token}`);
    }
  }
};

const isMissingValue = (next: string | undefined): boolean =>
  next === undefined ||
  next === '' ||
  next === '--' ||
  optionOf(next) !== undefined;

const assertValuesAndPositionals = (
  rawArgs: readonly string[],
  lookup: Lookup,
  limit: number,
): void => {
  const head = headOf(rawArgs);
  const tail = rawArgs.slice(head.length + 1);
  let positionals = 0;
  const countPositional = (token: string): void => {
    positionals += 1;
    if (positionals > limit) {
      throw new ArgumentError(`unexpected argument ${token}`);
    }
  };
  for (let index = 0; index < head.length; index += 1) {
    const token = head[index] ?? '';
    const option = optionOf(token);
    if (option === undefined) {
      countPositional(token);
      continue;
    }
    const defs = defsOfOption(token, option, lookup) ?? [];
    if (!takesValue(defs[defs.length - 1])) {
      continue;
    }
    if (option.inline) {
      if (option.inlineValue === '') {
        throw new ArgumentError(`${token.split('=')[0]} requires a value`);
      }
    } else if (isMissingValue(rawArgs[index + 1])) {
      throw new ArgumentError(`${token} requires a value`);
    } else {
      index += 1;
    }
  }
  for (const token of tail) {
    countPositional(token);
  }
};

export const assertValidArgs = (
  defs: ArgsDef,
  rawArgs: readonly string[],
  checkPositionals = true,
): void => {
  const lookup = lookupOf(defs);
  assertKnownOptions(rawArgs, lookup);
  assertValuesAndPositionals(
    rawArgs,
    lookup,
    checkPositionals ? positionalLimitOf(defs) : Number.POSITIVE_INFINITY,
  );
};

export const parseWholeNumber = (
  value: string | number,
  label: string,
  range: WholeNumberRange,
): number => {
  const text = String(value).trim();
  const number = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (
    !Number.isSafeInteger(number) ||
    number < range.min ||
    (range.max !== undefined && number > range.max)
  ) {
    const bound =
      range.max === undefined
        ? `at least ${range.min}`
        : `between ${range.min} and ${range.max}`;
    throw new ArgumentError(
      `${label} takes a whole number ${bound}, not "${String(value)}"`,
    );
  }
  return number;
};

export const parsePort = (value: string | number, label: string): number =>
  parseWholeNumber(value, label, { min: 1, max: MAX_PORT });

export const requiredPositional = (
  value: string | undefined,
  label: string,
): string => {
  if (value === undefined || value.trim() === '') {
    throw new ArgumentError(`${label} is required`);
  }
  return value;
};
