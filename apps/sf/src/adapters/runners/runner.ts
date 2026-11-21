/** Whether an agent may change files. `read` is enforced by the runner's own flags. */
export type Permission = 'read' | 'write';

/** Answers whether a binary is on PATH. */
export type BinaryProbe = (binary: string) => Promise<boolean>;

export interface CommandSpec {
  /** the prompt file the agent is told to read, relative to the worktree */
  promptFile: string;
  /** omitted when the Line gives no model; the CLI then uses its default */
  model?: string;
  permission: Permission;
}

/**
 * One agent CLI started as a headless print-mode process. Runner-specific
 * flags live only in the adapter's own file under src/adapters/runners/.
 */
export interface RunnerAdapter {
  readonly name: string;
  /** argv, binary first, for one non-interactive run */
  buildCommand(spec: CommandSpec): string[];
  /** argv for a TUI session that starts on the prompt; absent when the CLI has none */
  buildInteractive?(spec: CommandSpec): string[];
  checkInstalled(probe: BinaryProbe): Promise<boolean>;
}

export const promptFor = (promptFile: string): string =>
  `Read ${promptFile} and follow the instructions in it.`;
