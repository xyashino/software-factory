export interface FsPort {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string, mode?: number): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  readStdin(): Promise<string>;
}
