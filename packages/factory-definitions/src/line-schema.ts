import { basename } from 'node:path';
import { z } from 'zod';
import {
  isMachineIndependentId,
  isMachineIndependentText,
} from '@repo/factory-core/machine-local';
import { err, ok, type Result } from '@repo/factory-core/result';
import { parseDuration } from './duration';
import { zodErrors, type DefinitionError } from './errors';
import { parseYaml } from './frontmatter';
import type { Source } from './operator-profile';

/** Runner names with an adapter. Only the name is checked here; adapters live in the Cell. */
export const RUNNERS: readonly string[] = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
  'opencode',
];

/** Station ids and profile names: kebab-case, like `quality-gate`. */
const KEBAB_ID = /^[a-z][a-z0-9-]*$/;
/** Artifact keys: camelCase, like `commit`. */
const ARTIFACT_KEY = /^[a-z][a-zA-Z0-9]*$/;
/** `<stationId>.<artifactKey>` or `<stationId>.gate`. */
const INPUT_REF = /^([a-z][a-z0-9-]*)\.([a-z][a-zA-Z0-9]*)$/;
const TAG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DURATION_HINT = 'must be a duration like 30s, 20m or 1h';
const MAX_RANGE_HINT = 'must be a whole number from 1 to 5';
const RESTART_HINT = 'must be a whole number from 0 to 100';
const RESERVED_STATION_IDS: readonly string[] = ['task', 'operator'];
/** Reserved artifact key: `<inspectionId>.gate` is the inspection's pass result. */
const GATE_KEY = 'gate';
const TOP_LEVEL_OPERATOR_MESSAGE =
  'schema v2 has no top-level operator block; declare the profile under operators: and name it from a station with operator:';

export type Permission = 'read' | 'write';

/** A reference to an artifact a station hands over: `<stationId>.<artifactKey>`. */
export interface ArtifactRef {
  stationId: string;
  artifactKey: string;
}

/** A station input: an artifact of an earlier Operator station, or an Inspection's pass result. */
export type InputRef =
  | { kind: 'artifact'; stationId: string; artifactKey: string }
  | { kind: 'gate'; stationId: string };

export interface OnFail {
  retry: string;
  max: number;
}

/** A named operator: which profile runs, with which runner, model and limits. */
export interface OperatorPool {
  profile: string;
  runner: string;
  model: string;
  timeoutMs: number;
  headless: boolean;
  permission: Permission;
}

/** Fields every Station shares, schema v2. */
interface StationBase {
  id: string;
  /** capability tags a Cell must have to run this Station */
  requires: string[];
  onFail?: OnFail;
  maxRestarts: number;
  maxLostRestarts: number;
  /** `false` opts the station out of the line changeover; a block overrides it */
  changeover?: ChangeoverBlock | false;
}

export interface OperatorStation extends StationBase {
  kind: 'operator';
  /** key of an entry in the Line's `operators` map */
  operator: string;
  inputs: InputRef[];
}

export interface InspectionStation extends StationBase {
  kind: 'inspection';
  timeoutMs: number;
  /** shell commands, run in order */
  exec: string[];
}

export type LineStation = OperatorStation | InspectionStation;

/** A timed list of shell commands, the shape of `workspace.sync`. */
export interface CommandBlock {
  timeoutMs: number;
  exec: string[];
}

/**
 * A changeover: the commands that bring a worktree up to date with its Line
 * (`pnpm install`, say). `keyFiles` are repo-relative paths or globs whose git
 * blob hashes decide when the cache is stale; without them the changeover runs
 * once per base commit.
 */
export interface ChangeoverBlock {
  timeoutMs: number;
  exec: string[];
  keyFiles?: string[];
}

/** An assembly line, schema v2, normalised: durations in milliseconds, defaults filled. */
export interface Line {
  name: string;
  description: string;
  /** Per-job workspace preparation, run before any station of a job. Not a phase. */
  workspace: { sync?: CommandBlock; changeover?: ChangeoverBlock };
  operators: Record<string, OperatorPool>;
  stations: LineStation[];
  deliver: {
    commit: ArtifactRef;
    report: ArtifactRef;
    to: 'new-pr';
    /** `false` opts the delivery out of the line changeover; a block overrides it */
    changeover?: ChangeoverBlock | false;
  };
  /** absolute path of the Line file */
  path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** `<stationId>.<artifactKey>` or `<stationId>.gate`, or null when neither. */
const parseRef = (value: string): InputRef | null => {
  const match = INPUT_REF.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  if (match[2] === GATE_KEY) {
    return { kind: 'gate', stationId: match[1] };
  }
  if (!ARTIFACT_KEY.test(match[2])) {
    return null;
  }
  return { kind: 'artifact', stationId: match[1], artifactKey: match[2] };
};

const durationSchema = z.string().transform((value, ctx) => {
  const ms = parseDuration(value);
  if (ms === null) {
    ctx.addIssue({
      code: 'custom',
      message: `${DURATION_HINT}, got "${value}"`,
    });
    return z.NEVER;
  }
  return ms;
});

/** A repo-relative path or glob: no leading slash, no `..` segment. */
const keyFileSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(512)
  .refine(
    (value) => !value.startsWith('/') && !value.split('/').includes('..'),
    'must be a repo-relative path or glob',
  );

const machineText = z
  .string()
  .min(1, 'must not be empty')
  .max(512)
  .refine(
    isMachineIndependentText,
    'command must not contain machine-local values',
  );

const stationIdSchema = z
  .string()
  .regex(KEBAB_ID, 'must be kebab-case, like "quality-gate"')
  .refine((id) => !RESERVED_STATION_IDS.includes(id), 'is a reserved id');

const tagSchema = z
  .string()
  .regex(TAG, 'must be a lowercase tag, like "docker"')
  .refine(isMachineIndependentId, 'tag must not name a machine-local value');

const inputRefSchema = z.string().transform((value, ctx) => {
  const ref = parseRef(value);
  if (ref === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be <stationId>.<artifactKey> or <stationId>.gate',
    });
    return z.NEVER;
  }
  return ref;
});

const artifactRefSchema = z.string().transform((value, ctx) => {
  const ref = parseRef(value);
  if (ref === null || ref.kind !== 'artifact') {
    ctx.addIssue({
      code: 'custom',
      message: 'must be <stationId>.<artifactKey>',
    });
    return z.NEVER;
  }
  return { stationId: ref.stationId, artifactKey: ref.artifactKey };
});

export const onFailSchema = z.strictObject({
  retry: z.string().regex(KEBAB_ID, 'must be a station id'),
  max: z
    .number()
    .int(MAX_RANGE_HINT)
    .min(1, MAX_RANGE_HINT)
    .max(5, MAX_RANGE_HINT),
});

const restartSchema = (defaultValue: number) =>
  z
    .number()
    .int(RESTART_HINT)
    .min(0, RESTART_HINT)
    .max(100, RESTART_HINT)
    .default(defaultValue);

export const operatorPoolSchema = z.strictObject({
  profile: z.string().regex(KEBAB_ID, 'must be a profile id, like "builder"'),
  runner: z.string().refine((value) => RUNNERS.includes(value), {
    message: `must be one of ${RUNNERS.join(', ')}`,
  }),
  model: z.string().min(1, 'must not be empty'),
  timeout: durationSchema,
  headless: z.boolean().default(false),
  permission: z
    .enum(['read', 'write'], { error: 'must be one of read, write' })
    .default('write'),
});

export const commandBlockSchema = z.strictObject({
  timeout: durationSchema,
  exec: z.array(machineText).min(1, 'must list at least one command'),
});

export const changeoverSchema = commandBlockSchema.extend({
  keyFiles: z
    .array(keyFileSchema)
    .min(1, 'must list at least one key file, or leave keyFiles out')
    .max(64, 'must list at most 64 key files')
    .optional(),
});

/** A station or deliver opt-out: `changeover: false`, or a changeover that replaces the line's. */
export const changeoverOverrideSchema = z
  .union([
    z.literal(false, { error: 'must be false or a changeover block' }),
    changeoverSchema,
  ])
  .optional();

/** Per-job workspace preparation: optional `sync` and optional `changeover`, never a station. */
export const workspaceSchema = z.strictObject({
  sync: commandBlockSchema.optional(),
  changeover: changeoverSchema.optional(),
});

export const operatorStationSchema = z.strictObject({
  id: stationIdSchema,
  kind: z.literal('operator'),
  operator: z.string().regex(KEBAB_ID, 'must name a key of operators:'),
  inputs: z.array(inputRefSchema).default([]),
  requires: z.array(tagSchema).max(32).default([]),
  onFail: onFailSchema.optional(),
  maxRestarts: restartSchema(1),
  maxLostRestarts: restartSchema(3),
  changeover: changeoverOverrideSchema,
});

export const inspectionStationSchema = z.strictObject({
  id: stationIdSchema,
  kind: z.literal('inspection'),
  timeout: durationSchema,
  exec: z
    .array(machineText)
    .min(1, 'must list at least one command')
    .max(32, 'must list at most 32 commands'),
  requires: z.array(tagSchema).max(32).default([]),
  onFail: onFailSchema.optional(),
  maxRestarts: restartSchema(1),
  maxLostRestarts: restartSchema(3),
  changeover: changeoverOverrideSchema,
});

const stationSchema = z.discriminatedUnion('kind', [
  operatorStationSchema,
  inspectionStationSchema,
]);

export const deliverSchema = z.strictObject({
  commit: artifactRefSchema,
  report: artifactRefSchema,
  to: z.literal('new-pr', { error: 'must be new-pr' }),
  changeover: changeoverOverrideSchema,
});

/**
 * The YAML shape of a Line, schema v2. `operator:` is not a key of it: the
 * parser reports that key before this schema runs.
 */
export const lineFileSchema = z.strictObject({
  schemaVersion: z.literal(2, { error: 'must be 2' }),
  name: z.string().regex(KEBAB_ID, 'must be kebab-case, like "feature"'),
  description: z.string().min(1, 'must not be empty'),
  workspace: workspaceSchema,
  operators: z
    .record(z.string(), operatorPoolSchema)
    .superRefine((operators, ctx) => {
      for (const key of Object.keys(operators)) {
        if (!KEBAB_ID.test(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'must be kebab-case, like "builder"',
          });
        }
      }
      if (Object.keys(operators).length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'must declare at least one operator',
        });
      }
    }),
  stations: z
    .array(stationSchema)
    .min(1, 'must contain at least one station')
    .max(64, 'must contain at most 64 stations'),
  deliver: deliverSchema,
});

type LineFileData = z.infer<typeof lineFileSchema>;
type OperatorPoolData = z.infer<typeof operatorPoolSchema>;
type StationData = z.infer<typeof stationSchema>;
type ChangeoverData = z.infer<typeof changeoverSchema>;

const toOperatorPool = (data: OperatorPoolData): OperatorPool => ({
  profile: data.profile,
  runner: data.runner,
  model: data.model,
  timeoutMs: data.timeout,
  headless: data.headless,
  permission: data.permission,
});

const toChangeoverBlock = (data: ChangeoverData): ChangeoverBlock => ({
  timeoutMs: data.timeout,
  exec: data.exec,
  ...(data.keyFiles === undefined ? {} : { keyFiles: data.keyFiles }),
});

/** A parsed changeover override: `false`, or the block in milliseconds. */
const toChangeover = (
  data: ChangeoverData | false | undefined,
): ChangeoverBlock | false | undefined =>
  data === undefined || data === false ? data : toChangeoverBlock(data);

const toStation = (data: StationData): LineStation => {
  const changeover = toChangeover(data.changeover);
  const base = {
    id: data.id,
    requires: data.requires,
    ...(data.onFail === undefined ? {} : { onFail: data.onFail }),
    maxRestarts: data.maxRestarts,
    maxLostRestarts: data.maxLostRestarts,
    ...(changeover === undefined ? {} : { changeover }),
  };
  if (data.kind === 'operator') {
    return {
      ...base,
      kind: 'operator',
      operator: data.operator,
      inputs: data.inputs,
    };
  }
  return {
    ...base,
    kind: 'inspection',
    timeoutMs: data.timeout,
    exec: data.exec,
  };
};

const toLine = (data: LineFileData, path: string): Line => {
  const { sync, changeover } = data.workspace;
  const deliverChangeover = toChangeover(data.deliver.changeover);
  return {
    name: data.name,
    description: data.description,
    workspace: {
      ...(sync === undefined
        ? {}
        : { sync: { timeoutMs: sync.timeout, exec: sync.exec } }),
      ...(changeover === undefined
        ? {}
        : { changeover: toChangeoverBlock(changeover) }),
    },
    operators: Object.fromEntries(
      Object.entries(data.operators).map(([key, pool]) => [
        key,
        toOperatorPool(pool),
      ]),
    ),
    stations: data.stations.map(toStation),
    deliver: {
      commit: data.deliver.commit,
      report: data.deliver.report,
      to: data.deliver.to,
      ...(deliverChangeover === undefined
        ? {}
        : { changeover: deliverChangeover }),
    },
    path,
  };
};

/**
 * Parses a Line YAML file. Every schema problem is collected, each with its
 * file and field. Cross-file rules are checked later by validateLine.
 */
export const parseLine = (
  source: Source,
  text: string,
): Result<Line, DefinitionError[]> => {
  const yaml = parseYaml(source.file, text);
  if (!yaml.ok) {
    return yaml;
  }

  const errors: DefinitionError[] = [];
  let raw = yaml.value;
  if (isRecord(raw) && Object.hasOwn(raw, 'operator')) {
    errors.push({
      file: source.file,
      field: 'operator',
      message: TOP_LEVEL_OPERATOR_MESSAGE,
    });
    raw = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== 'operator'),
    );
  }

  const parsed = lineFileSchema.safeParse(raw, { reportInput: true });
  if (!parsed.success) {
    errors.push(...zodErrors(source.file, parsed.error));
  }

  const expectedName = basename(source.file, '.yml');
  if (parsed.success && parsed.data.name !== expectedName) {
    errors.push({
      file: source.file,
      field: 'name',
      message: `must equal the file name "${expectedName}"`,
    });
  }

  if (!parsed.success || errors.length > 0) {
    return err(errors);
  }
  return ok(toLine(parsed.data, source.path));
};
