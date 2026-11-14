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

/** What a Herdr pane reports now (CORE §9.1). */
export interface PaneReading {
  operator: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown';
}

/** A Herdr pane the Cell drives: open, type, read, close (PROTOCOL §9, v1 Herdr adapter). */
export interface PaneDriver {
  open(spec: LaunchSpec & { name: string }): Promise<void>;
  type(name: string, text: string): Promise<void>;
  read(name: string): Promise<PaneReading>;
  /** The sanitized last lines of the pane, for a stall alert. */
  tail(name: string): Promise<string>;
  close(name: string): Promise<void>;
}
