export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** A role: who works at a station and which files it hands over. */
export interface Role {
  id: string;
  label: string;
  verdict: boolean;
  /** rule or group ids declared in `.nitpick/config.ts` */
  rules: string[];
  /** skill ids: `.nitpick/skills/<id>/SKILL.md` */
  skills: string[];
  /** key -> plain file name written into the attempt directory */
  artifacts: Record<string, string>;
  /** prompt body, without frontmatter */
  body: string;
  /** absolute path of the role file */
  path: string;
}

/** A pool entry: how a role is run. Lives only in workflows. */
export interface AgentDef {
  role: string;
  runner: string;
  model: string;
  timeoutMs: number;
  /** runs through the runner's print mode, without a Herdr pane */
  headless: boolean;
  /** `read` makes the runner itself refuse file changes */
  permission: 'read' | 'write';
}

/** `<stepId>.<artifactKey>` */
export interface ArtifactRef {
  stepId: string;
  artifactKey: string;
}

/** `<stepId>.<artifactKey>`, `<commandsStepId>.gate` or `task.<field>` */
export type InputRef =
  | ArtifactRef
  | { source: 'task'; field: string }
  | { source: 'gate'; stepId: string };

export interface OnFail {
  retry: string;
  max: number;
}

export interface AgentStep {
  id: string;
  type: 'agent';
  agent: string;
  inputs: InputRef[];
  onFail?: OnFail;
}

export interface CommandsStep {
  id: string;
  type: 'commands';
  exec: string[];
  timeoutMs: number;
  onFail?: OnFail;
}

export type Step = AgentStep | CommandsStep;

export interface DeliverDef {
  commit: ArtifactRef;
  report: ArtifactRef;
  to: 'new-pr';
}

/** An assembly line: which agents run, in what order, with which gates. */
export interface Workflow {
  name: string;
  description: string;
  /** Runs in the repo root before the worktree exists; discards local changes on main. */
  sync?: { timeoutMs: number; exec: string[] };
  /** Runs in the task worktree after it is created. */
  setup: { timeoutMs: number; exec: string[] };
  agents: Record<string, AgentDef>;
  steps: Step[];
  deliver: DeliverDef;
  operator?: AgentDef;
  /** absolute path of the workflow file */
  path: string;
}

/** A supervisor prompt template. */
export interface Template {
  id: string;
  body: string;
  /** absolute path of the template file */
  path: string;
}

export interface Definitions {
  roles: Map<string, Role>;
  workflows: Map<string, Workflow>;
  templates: Map<string, Template>;
  /** the PR markdown templates under `templates/pr/` */
  prTemplates: Map<string, Template>;
}
