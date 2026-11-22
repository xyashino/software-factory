export interface RunSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  logPath: string;
  interactive?: boolean;
}

export interface RunPane {
  workspaceId: string;
  tabId: string;
  paneId: string;
}

export interface RunHandle {
  id: string;
  /** the terminal pane a run opened, when it has one */
  pane?: RunPane;
  /** the pid that stays alive while the run's agent does */
  pid?: number;
}

export interface RunOutcome {
  exitCode: number;
}

export interface RunnerPort {
  prepare(): Promise<void>;
  start(spec: RunSpec): Promise<RunHandle>;
  /** Resolves once the run's processes are gone; false when they outlive the adapter's limit. */
  abort(handle: RunHandle): Promise<boolean>;
  wait(handle: RunHandle): Promise<RunOutcome>;
  interactiveAvailable(): Promise<boolean>;
}
