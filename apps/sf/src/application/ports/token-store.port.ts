import type { Access } from '../../domain/access';

export interface TokenStorePort {
  read(): Promise<Access | null>;
  secret(): Promise<string | null>;
  write(secret: string): Promise<void>;
  clear(): Promise<void>;
}
