export interface PidFilePort {
  read(dataDir: string): Promise<number | null>;
  write(dataDir: string, pid: number): Promise<void>;
  remove(dataDir: string): Promise<void>;
}
