/** Whether an agent may change files. `read` is enforced by the runner's own flags. */
export type Permission = 'read' | 'write';

/** Tokens and cost a runner reported for one headless run. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

/**
 * How one agent CLI is started, in a Herdr pane or as a headless print-mode
 * process. Runner-specific flags live only in the adapter's own file under
 * src/adapters/runners/.
 */
export interface RunnerAdapter {
  /** the name used in workflow `agents:` entries */
  readonly name: string;
  /** the `herdr agent start --kind` value */
  readonly kind: string;
  /** the binary headless mode runs; absent when the runner has no print mode */
  readonly binary?: string;
  /**
   * arguments after `--` for `herdr agent start`: model and unattended execution.
   * `addDirs` are extra directories the agent may read without asking (the
   * prompt and evidence live outside the task worktree). `permission` defaults
   * to `write`. Only runners with `readOnly` accept `read`.
   */
  startArgs(options: {
    model: string;
    addDirs?: readonly string[];
    permission?: Permission;
  }): string[];
  /** the runner enforces a read-only mode with its own permission flags */
  readonly readOnly: boolean;
  /** argv (after the binary) of one non-interactive run; absent when unsupported */
  headlessArgs?(options: {
    model: string;
    permission: Permission;
    prompt: string;
    addDirs: readonly string[];
  }): string[];
  /** token usage from a headless run's stdout; undefined when it reports none */
  parseUsage?(stdout: string): TokenUsage | undefined;
}
