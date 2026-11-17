/** Milliseconds since an epoch the Cell reads from its clock port, so tests can drive time. */
export interface Clock {
  now(): number;
}

/** The result of one git invocation. A non-zero `code` is an answer, not a thrown error. */
export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs git with an argument vector (never a shell string) in a directory. */
export type RunGit = (
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<GitResult>;

/** A command the Cell starts for an Operator, headless or in a pane. */
export interface LaunchSpec {
  command: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdoutPath: string;
  stderrPath: string;
}

/** A running headless Operator: liveness, output age, typed input and a stop. */
export interface HeadlessProcess {
  readonly pid: number;
  /** True until the process has exited. */
  alive(): boolean;
  /** Resolves with the exit code when the process ends. */
  readonly exit: Promise<number | null>;
  /** Types text into the process's input, as an Operator reads its prompts. */
  type(text: string): void;
  /** Ends the process. Idempotent. */
  stop(): void;
}

/** The outcome of one workspace command: ok, or the detail of why it failed (exit, output, timeout). */
export interface ShellResult {
  ok: boolean;
  detail: string;
}

/** Runs one `sync` or `setup` line of a Job in a directory, bounded by its timeout. */
export type RunShell = (
  cwd: string,
  command: string,
  timeoutMs: number,
) => Promise<ShellResult>;

/** Starts a headless Operator process. The Cell never waits on it synchronously. */
export type SpawnHeadless = (spec: LaunchSpec) => HeadlessProcess;

/** What a Herdr pane reports now. */
export interface PaneReading {
  operator: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown';
}

/** Where a pane's tab lives in Herdr: what a later Cell needs to close the tab it did not open. */
export interface PaneLocation {
  tabId: string;
}

/** A Herdr pane the Cell drives: open, type, read, close. */
export interface PaneDriver {
  /** `task` is the Work order's todo: one Herdr workspace per task, holds its Operator tabs. */
  open(
    spec: LaunchSpec & {
      name: string;
      task: string;
      /** Run in the task's `logs` tab when the workspace is created. */
      logCommand?: string;
    },
  ): Promise<PaneLocation>;
  /** Re-learns a pane an earlier Cell opened, from its session file, so `close` reaches its tab. */
  adopt(name: string, location: PaneLocation): void;
  type(name: string, text: string): Promise<void>;
  read(name: string): Promise<PaneReading>;
  /** The sanitized last lines of the pane, for a stall alert. */
  tail(name: string): Promise<string>;
  close(name: string): Promise<void>;
  /** Confirms a folder-trust screen if the Operator is stuck on one. */
  confirmTrust(name: string): Promise<boolean>;
  /** Closes the task's Herdr workspace once its Work order is delivered; a task with none is a no-op. */
  closeTask(task: string): Promise<void>;
}
