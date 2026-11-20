export interface RunSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  logPath: string;
  interactive?: boolean;
}

export interface RunHandle {
  id: string;
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
