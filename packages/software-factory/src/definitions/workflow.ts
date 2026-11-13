import { basename } from 'node:path';
import { z } from 'zod';
import { zodErrors, type DefinitionError } from './errors';
import { parseDuration } from './duration';
import { parseYaml } from './frontmatter';
import type { Source } from './role';
import type {
  AgentDef,
  ArtifactRef,
  InputRef,
  Result,
  Step,
  Workflow,
} from './types';

/** Runner names with an adapter. Stage 1 only checks the name; adapters arrive later. */
export const RUNNERS: readonly string[] = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
  'opencode',
];

const KEBAB_ID = /^[a-z][a-z0-9-]*$/;
const DURATION_HINT = 'must be a duration like 30s, 20m or 1h';
const MAX_RANGE_HINT = 'must be a whole number from 1 to 5';
const TASK_REF = /^task\.([a-zA-Z][a-zA-Z0-9]*)$/;
const ARTIFACT_REF = /^([a-z][a-z0-9-]*)\.([a-z][a-zA-Z0-9]*)$/;

/** Reserved artifact key: `<commandsStepId>.gate` is the gate's pass result. */
const GATE_KEY = 'gate';

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

const stepIdSchema = z
  .string()
  .regex(KEBAB_ID, 'must be kebab-case, like "quality-gate"')
  .refine((id) => id !== 'task', '"task" is a reserved step id')
  .refine((id) => id !== 'operator', '"operator" is a reserved step id');

const inputRefSchema = z.string().transform((value, ctx) => {
  const ref = parseInputRef(value);
  if (ref === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be <stepId>.<artifactKey>, <stepId>.gate or task.<field>',
    });
    return z.NEVER;
  }
  return ref;
});

const artifactRefSchema = z.string().transform((value, ctx) => {
  const ref = parseInputRef(value);
  if (ref === null || 'source' in ref) {
    ctx.addIssue({ code: 'custom', message: 'must be <stepId>.<artifactKey>' });
    return z.NEVER;
  }
  return ref;
});

const onFailSchema = z.strictObject({
  retry: z.string().regex(KEBAB_ID, 'must be a step id'),
  max: z
    .number()
    .int(MAX_RANGE_HINT)
    .min(1, MAX_RANGE_HINT)
    .max(5, MAX_RANGE_HINT),
});

const agentDefSchema = z.strictObject({
  role: z.string().regex(KEBAB_ID, 'must be a role id, like "worker"'),
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

const agentStepSchema = z.strictObject({
  id: stepIdSchema,
  type: z.literal('agent'),
  agent: z.string().min(1, 'must name a key of agents:'),
  inputs: z.array(inputRefSchema).default([]),
  onFail: onFailSchema.optional(),
});

const commandsStepSchema = z.strictObject({
  id: stepIdSchema,
  type: z.literal('commands'),
  timeout: durationSchema,
  exec: z
    .array(z.string().min(1, 'must not be empty'))
    .min(1, 'must list at least one command'),
  onFail: onFailSchema.optional(),
});

/** A timed list of shell commands: the shape of `sync` and `setup`. */
const commandBlockSchema = z.strictObject({
  timeout: durationSchema,
  exec: z
    .array(z.string().min(1, 'must not be empty'))
    .min(1, 'must list at least one command'),
});

const workflowSchema = z.strictObject({
  name: z.string().min(1, 'must not be empty'),
  description: z.string().min(1, 'must not be empty'),
  sync: commandBlockSchema.optional(),
  setup: commandBlockSchema,
  agents: z.record(z.string(), agentDefSchema).superRefine((agents, ctx) => {
    for (const key of Object.keys(agents)) {
      if (!KEBAB_ID.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be kebab-case, like "worker"',
        });
      }
    }
    if (Object.keys(agents).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'must declare at least one agent',
      });
    }
  }),
  operator: agentDefSchema,
  steps: z
    .array(z.discriminatedUnion('type', [agentStepSchema, commandsStepSchema]))
    .min(1, 'must contain at least one step'),
  deliver: z.strictObject({
    commit: artifactRefSchema,
    report: artifactRefSchema,
    to: z.literal('new-pr', { error: 'must be new-pr' }),
  }),
});

type WorkflowData = z.infer<typeof workflowSchema>;
type AgentDefData = z.infer<typeof agentDefSchema>;

const toAgentDef = (data: AgentDefData): AgentDef => {
  return {
    role: data.role,
    runner: data.runner,
    model: data.model,
    timeoutMs: data.timeout,
    headless: data.headless,
    permission: data.permission,
  };
};

const toWorkflow = (data: WorkflowData, path: string): Workflow => {
  const steps: Step[] = data.steps.map((step) => {
    if (step.type === 'agent') {
      return step;
    }
    return {
      id: step.id,
      type: 'commands',
      exec: step.exec,
      timeoutMs: step.timeout,
      onFail: step.onFail,
    };
  });
  const agents = Object.fromEntries(
    Object.entries(data.agents).map(([key, agent]) => [key, toAgentDef(agent)]),
  );
  const deliver: {
    commit: ArtifactRef;
    report: ArtifactRef;
    to: 'new-pr';
  } = {
    commit: data.deliver.commit,
    report: data.deliver.report,
    to: data.deliver.to,
  };
  return {
    name: data.name,
    description: data.description,
    ...(data.sync === undefined
      ? {}
      : { sync: { timeoutMs: data.sync.timeout, exec: data.sync.exec } }),
    setup: { timeoutMs: data.setup.timeout, exec: data.setup.exec },
    agents,
    steps,
    deliver,
    operator: toAgentDef(data.operator),
    path,
  };
};

/** `<stepId>.<artifactKey>` or `task.<field>`, or null when neither. */
export const parseInputRef = (value: string): InputRef | null => {
  const task = TASK_REF.exec(value);
  if (task?.[1] !== undefined) {
    return { source: 'task', field: task[1] };
  }
  const artifact = ARTIFACT_REF.exec(value);
  if (artifact?.[1] !== undefined && artifact[2] !== undefined) {
    if (artifact[2] === GATE_KEY) {
      return { source: 'gate', stepId: artifact[1] };
    }
    return { stepId: artifact[1], artifactKey: artifact[2] };
  }
  return null;
};

/**
 * Parses a workflow YAML file. Schema problems carry the YAML path; cross-file
 * rules are checked later by validateWorkflow.
 */
export const parseWorkflow = (
  source: Source,
  text: string,
): Result<Workflow, DefinitionError[]> => {
  const yaml = parseYaml(source.file, text);
  if (!yaml.ok) {
    return yaml;
  }

  const parsed = workflowSchema.safeParse(yaml.value, { reportInput: true });
  if (!parsed.success) {
    return { ok: false, error: zodErrors(source.file, parsed.error) };
  }

  const expectedName = basename(source.file, '.yml');
  if (parsed.data.name !== expectedName) {
    return {
      ok: false,
      error: [
        {
          file: source.file,
          field: 'name',
          message: `must equal the file name "${expectedName}"`,
        },
      ],
    };
  }

  return { ok: true, value: toWorkflow(parsed.data, source.path) };
};
