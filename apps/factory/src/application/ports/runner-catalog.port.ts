export interface CommandLine {
  command: string;
  args: string[];
}

export interface RunnerCatalogPort {
  names(): readonly string[];
  isInstalled(name: string): Promise<boolean>;
  commandLine(name: string, promptFile: string): CommandLine | undefined;
}
