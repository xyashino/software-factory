import type { FactoryCredential } from '../../domain/factory/factory-credential';

export interface FactoryCredentialPort {
  read(): FactoryCredential | null;
  write(credential: FactoryCredential): void;
}
