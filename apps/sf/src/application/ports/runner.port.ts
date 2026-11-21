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
}

export interface RunOutcome {
  exitCode: number;
}

export interface RunnerPort {
  prepare(): Promise<void>;
  start(spec: RunSpec): Promise<RunHandle>;
  abort(handle: RunHandle): Promise<void>;
  wait(handle: RunHandle): Promise<RunOutcome>;
  interactiveAvailable(): Promise<boolean>;
}
