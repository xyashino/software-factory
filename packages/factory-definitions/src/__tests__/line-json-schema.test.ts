import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  commandBlockSchema,
  deliverSchema,
  inspectionStationSchema,
  lineFileSchema,
  onFailSchema,
  operatorPoolSchema,
  operatorStationSchema,
  workspaceSchema,
} from '../line-schema';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const SCHEMA_FILE = join(PACKAGE_ROOT, 'schemas', 'line.schema.json');
const LINES = join(PACKAGE_ROOT, 'lines');
const VALID = join(
  import.meta.dirname,
  'fixtures',
  'valid',
  'lines',
  'feature.yml',
);

type Json = Record<string, unknown>;

const schema = (): Json =>
  JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as Json;

const compile = () =>
  new Ajv({ strict: true, allErrors: true }).compile(schema());

const errorsOf = (doc: unknown) => {
  const validate = compile();
  return validate(doc) ? [] : (validate.errors ?? []);
};

const readYaml = (file: string): Json =>
  parse(readFileSync(file, 'utf8')) as Json;

/** Every property name the JSON Schema declares, at any depth. */
const schemaKeys = (node: unknown, out = new Set<string>()): Set<string> => {
  if (typeof node !== 'object' || node === null) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => schemaKeys(item, out));
    return out;
  }
  const record = node as Json;
  if (
    typeof record['properties'] === 'object' &&
    record['properties'] !== null
  ) {
    for (const key of Object.keys(record['properties'] as Json)) out.add(key);
  }
  for (const value of Object.values(record)) schemaKeys(value, out);
  return out;
};

describe('line JSON schema', () => {
  it('compiles as a strict draft-07 document', () => {
    expect(() => compile()).not.toThrow();
  });

  it('declares the same keys as the zod schema, no more and no less', () => {
    const zodKeys = new Set(
      [
        lineFileSchema,
        workspaceSchema,
        commandBlockSchema,
        operatorPoolSchema,
        operatorStationSchema,
        inspectionStationSchema,
        onFailSchema,
        deliverSchema,
      ].flatMap((object) => Object.keys(object.shape)),
    );
    expect([...schemaKeys(schema())].sort()).toEqual([...zodKeys].sort());
  });

  it.each(readdirSync(LINES).filter((file) => file.endsWith('.yml')))(
    'accepts the shipped line %s',
    (file) => {
      expect(errorsOf(readYaml(join(LINES, file)))).toEqual([]);
    },
  );

  it('accepts the valid fixture line', () => {
    expect(errorsOf(readYaml(VALID))).toEqual([]);
  });

  it('rejects schemaVersion 1', () => {
    const doc = { ...readYaml(VALID), schemaVersion: 1 };
    expect(errorsOf(doc).length).toBeGreaterThan(0);
  });

  it('rejects a top-level operator block', () => {
    const doc = {
      ...readYaml(VALID),
      operator: {
        profile: 'planner',
        runner: 'claude',
        model: 'sonnet',
        timeout: '20m',
      },
    };
    expect(errorsOf(doc).map((error) => error.keyword)).toContain(
      'additionalProperties',
    );
  });

  it('rejects an unknown key inside a station', () => {
    const doc = readYaml(VALID);
    const stations = doc['stations'] as Json[];
    stations[1] = { ...(stations[1] ?? {}), colour: 'red' };
    expect(errorsOf(doc).map((error) => error.keyword)).toContain(
      'additionalProperties',
    );
  });

  it('rejects an onFail.max above 5', () => {
    const doc = readYaml(VALID);
    const stations = doc['stations'] as Json[];
    stations[2] = {
      ...(stations[2] ?? {}),
      onFail: { retry: 'build', max: 6 },
    };
    expect(errorsOf(doc).map((error) => error.keyword)).toContain('maximum');
  });
});
