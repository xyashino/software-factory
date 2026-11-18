import type { Access } from '../../domain/access';

export interface TokenStorePort {
  read(): Promise<Access | null>;
  write(secret: string): Promise<void>;
  clear(): Promise<void>;
}
