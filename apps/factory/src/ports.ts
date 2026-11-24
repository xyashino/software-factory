import type { FactoryCredential } from '@repo/factory-contracts/status.contract';

export interface ClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface DetachedSpec {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  logPath: string;
  cwd?: string;
}

export interface ProcessPort {
  spawnDetached(spec: DetachedSpec): Promise<number>;
  isAlive(pid: number): boolean;
  terminate(pid: number): void;
  forceKill(pid: number): void;
}

export type HqReply<T> =
  { kind: 'ok'; value: T } | { kind: 'rejected' } | { kind: 'unreachable' };

export interface HqLinkPort {
  heartbeat(input: {
    url: string;
    sessionToken: string;
    projects: { projectId: string; desired: number; running: number }[];
  }): Promise<HqReply<{ factoryId: string }>>;
  goneCell(input: {
    url: string;
    sessionToken: string;
    cellId: string;
  }): Promise<HqReply<{ cellId: string }>>;
}

export interface CredentialStorePort {
  read(): FactoryCredential | null;
}

export interface PidFilePort {
  read(dataDir: string): Promise<number | null>;
  remove(dataDir: string): Promise<void>;
}

export interface RepoConfigPort {
  projectIdOf(repoRoot: string): Promise<string>;
  repoUrlOf(repoRoot: string): Promise<string>;
}

export interface FactoryPorts {
  clock: ClockPort;
  process: ProcessPort;
  hqLink: HqLinkPort;
  credentials: CredentialStorePort;
  pidFile: PidFilePort;
  repoConfig: RepoConfigPort;
}
