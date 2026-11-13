import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..', '..');
const SCHEMA_FILE = join(PACKAGE_ROOT, 'schemas', 'workflow.schema.json');
const WORKFLOWS = join(PACKAGE_ROOT, 'workflows');
const INVALID = join(import.meta.dirname, 'fixtures', 'invalid');
const VALID_FIXTURE = join(
  import.meta.dirname,
  'fixtures',
  'valid',
  'workflows',
  'feature.yml',
);

type Doc = Record<string, unknown>;

const readYaml = (file: string): Doc => {
  return parse(readFileSync(file, 'utf8')) as Doc;
};

const compile = () => {
  const schema: unknown = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));
  return new Ajv2020({ strict: true, allErrors: true }).compile(
    schema as object,
  );
};

const errorsOf = (doc: unknown) => {
  const validate = compile();
  return validate(doc) ? [] : (validate.errors ?? []);
};

const validFeature = (): Doc => {
  return readYaml(VALID_FIXTURE);
};

const stepsOf = (doc: Doc): Doc[] => {
  return doc['steps'] as Doc[];
};

describe('workflow JSON schema', () => {
  it('compiles as a strict JSON Schema 2020-12 document', () => {
    expect(() => compile()).not.toThrow();
  });

  const shipped = readdirSync(WORKFLOWS).filter((file) =>
    file.endsWith('.yml'),
  );

  it('covers the three shipped workflows', () => {
    expect(shipped.sort()).toEqual(['fast.yml', 'feature.yml', 'standard.yml']);
  });

  it.each(shipped)('accepts shipped workflow %s', (file) => {
    expect(errorsOf(readYaml(join(WORKFLOWS, file)))).toEqual([]);
  });

  it('accepts the valid fixture workflow', () => {
    expect(errorsOf(validFeature())).toEqual([]);
  });

  it('rejects a workflow without operator', () => {
    const doc = validFeature();
    delete doc['operator'];

    const errors = errorsOf(doc);

    expect(errors.map((e) => e.keyword)).toEqual(['required']);
    expect(errors[0]?.params).toEqual({ missingProperty: 'operator' });
  });

  it('rejects the operator-missing runtime fixture', () => {
    const doc = readYaml(
      join(INVALID, 'operator-missing', 'workflows', 'feature.yml'),
    );

    expect(errorsOf(doc)).not.toEqual([]);
  });

  it.each(['name', 'description', 'setup', 'agents', 'steps', 'deliver'])(
    'rejects a workflow without %s',
    (key) => {
      const doc = validFeature();
      delete doc[key];

      expect(errorsOf(doc)).not.toEqual([]);
    },
  );

  it('accepts a workflow without sync', () => {
    const doc = validFeature();
    delete doc['sync'];

    expect(errorsOf(doc)).toEqual([]);
  });

  it.each(['sync-missing-timeout', 'sync-empty-exec'])(
    'rejects the %s fixture',
    (name) => {
      const doc = readYaml(join(INVALID, name, 'workflows', 'feature.yml'));

      expect(errorsOf(doc)).not.toEqual([]);
    },
  );

  it('rejects an unknown runner', () => {
    const doc = validFeature();
    doc['operator'] = {
      role: 'operator',
      runner: 'gpt',
      model: 'x',
      timeout: '20m',
    };

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('enum');
  });

  it('rejects an unknown root key', () => {
    const doc = { ...validFeature(), extra: true };

    expect(errorsOf(doc).map((e) => e.keyword)).toContain(
      'additionalProperties',
    );
  });

  it('rejects a commands step without timeout', () => {
    const doc = validFeature();
    delete stepsOf(doc)[2]?.['timeout'];

    expect(errorsOf(doc)).not.toEqual([]);
  });

  it('rejects an agent step that carries exec', () => {
    const doc = validFeature();
    Object.assign(stepsOf(doc)[0] ?? {}, { exec: ['pnpm test'] });

    expect(errorsOf(doc)).not.toEqual([]);
  });

  it('rejects an unknown step type', () => {
    const doc = validFeature();
    Object.assign(stepsOf(doc)[0] ?? {}, { type: 'manual' });

    expect(errorsOf(doc)).not.toEqual([]);
  });

  it.each(['1.5m', '0s', '20', '-5m'])('rejects duration %s', (value) => {
    const doc = validFeature();
    Object.assign(doc['setup'] as Doc, { timeout: value });

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('pattern');
  });

  it('rejects empty steps', () => {
    const doc = { ...validFeature(), steps: [] };

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('minItems');
  });

  it('rejects an empty agent pool', () => {
    const doc = { ...validFeature(), agents: {} };

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('minProperties');
  });

  it('rejects a retry max above 5', () => {
    const doc = validFeature();
    Object.assign(stepsOf(doc)[2] ?? {}, {
      onFail: { retry: 'build', max: 6 },
    });

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('maximum');
  });

  it('rejects a reserved step id', () => {
    const doc = validFeature();
    Object.assign(stepsOf(doc)[0] ?? {}, { id: 'operator' });

    expect(errorsOf(doc)).not.toEqual([]);
  });

  it('rejects a malformed input reference', () => {
    const doc = validFeature();
    Object.assign(stepsOf(doc)[1] ?? {}, { inputs: ['plan'] });

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('pattern');
  });

  it('rejects a deliver target other than new-pr', () => {
    const doc = validFeature();
    Object.assign(doc['deliver'] as Doc, { to: 'merge' });

    expect(errorsOf(doc).map((e) => e.keyword)).toContain('enum');
  });
});
