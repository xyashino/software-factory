import type { FactoryCredential } from '@repo/factory-contracts/status.contract';

export interface FactoryCredentialPort {
  read(): FactoryCredential | null;
  write(credential: FactoryCredential): void;
}
