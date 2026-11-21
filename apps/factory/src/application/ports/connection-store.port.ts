import type { ConnectionConfig } from '../../domain/connection/connection-config';

export interface ConnectionStorePort {
  readonly path: string;
  read(): ConnectionConfig;
  write(config: ConnectionConfig): void;
}
