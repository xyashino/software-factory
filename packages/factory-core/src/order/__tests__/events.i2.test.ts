import { describe, expect, it } from 'vitest';
import { orderEventSchema } from '../events';
import { deliveryFinished, noteLeft, questionAsked, samples } from './builders';

type Path = (string | number)[];

/** Machine-local values that must never reach a stored event (I2). */
const MACHINE_LOCAL_TEXTS = [
  '/home/x/a',
  'C:\\work\\repo',
  '~/notes.md',
  'host.local',
  'my-host:8080',
  'localhost:3000',
  'w-1-2',
  'pane-7',
  '%3',
  'pid=4242',
];

const TYPES = Object.keys(samples) as (keyof typeof samples)[];

/** Paths to every string leaf of a value. */
const stringLeaves = (value: unknown, path: Path = []): Path[] => {
  if (typeof value === 'string') return [path];
  if (Array.isArray(value))
    return value.flatMap((item, index) => stringLeaves(item, [...path, index]));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      stringLeaves(child, [...path, key]),
    );
  }
  return [];
};

/** A copy of `value` with the leaf at `path` replaced. */
const withLeafReplaced = (
  value: unknown,
  path: Path,
  replacement: string,
): unknown => {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === 'number') {
    return value.map((item, index) =>
      index === head ? withLeafReplaced(item, rest, replacement) : item,
    );
  }
  if (value !== null && typeof value === 'object' && typeof head === 'string') {
    const record = value as Record<string, unknown>;
    return {
      ...record,
      [head]: withLeafReplaced(record[head], rest, replacement),
    };
  }
  return value;
};

/** Every key name used anywhere in the samples. */
const keyNames = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keyNames);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...keyNames(child),
    ]);
  }
  return [];
};

describe('I2 machine independence of stored events', () => {
  it.each(TYPES)(
    'rejects a machine-local value in any string field of %s',
    (type) => {
      const sample: unknown = samples[type];
      const accepted: string[] = [];
      for (const path of stringLeaves(sample)) {
        for (const text of MACHINE_LOCAL_TEXTS) {
          const mutated = withLeafReplaced(sample, path, text);
          if (orderEventSchema.safeParse(mutated).success) {
            accepted.push(`${path.join('.')} accepted ${text}`);
          }
        }
      }
      expect(accepted).toEqual([]);
    },
  );

  it('rejects an absolute path in a note', () => {
    expect(
      orderEventSchema.safeParse(
        noteLeft({ text: 'see /home/x/project/plan.md' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a hostname in a question', () => {
    expect(
      orderEventSchema.safeParse(
        questionAsked({ text: 'ask the box at build.lan' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a pane id in a note', () => {
    expect(
      orderEventSchema.safeParse(noteLeft({ text: 'moved to w-3-1' })).success,
    ).toBe(false);
  });

  it('keeps a github pull request url, the documented exception', () => {
    expect(orderEventSchema.safeParse(deliveryFinished()).success).toBe(true);
  });

  it('rejects a pull request url that is not https', () => {
    expect(
      orderEventSchema.safeParse(deliveryFinished({ prUrl: '/home/x/pr/42' }))
        .success,
    ).toBe(false);
  });

  it('names no field after a path, host, pane or process', () => {
    const names = keyNames(samples);
    expect(
      names.filter((name) => /path|host|pane|pid|tab/i.test(name)),
    ).toEqual([]);
  });
});
