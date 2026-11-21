export interface PidFilePort {
  read(dataDir: string): Promise<number | null>;
  write(dataDir: string, pid: number): Promise<void>;
  acquire(dataDir: string, pid: number): Promise<boolean>;
  remove(dataDir: string): Promise<void>;
}
