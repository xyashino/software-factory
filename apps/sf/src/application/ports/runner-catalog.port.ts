export interface CommandLine {
  command: string;
  args: string[];
}

export interface CommandOptions {
  model?: string;
  permission?: 'read' | 'write';
  /** the TUI form, or undefined when the runner has none */
  interactive?: boolean;
}

export interface RunnerCatalogPort {
  names(): readonly string[];
  isInstalled(name: string): Promise<boolean>;
  commandLine(
    name: string,
    promptFile: string,
    options?: CommandOptions,
  ): CommandLine | undefined;
}
