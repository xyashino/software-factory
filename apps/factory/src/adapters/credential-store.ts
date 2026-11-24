import { existsSync, readFileSync } from 'node:fs';
import {
  FactoryCredentialSchema,
  type FactoryCredential,
} from '@repo/factory-contracts/status.contract';
import { Refused } from '../errors';
import type { CredentialStorePort } from '../ports';

const parseFile = (path: string): FactoryCredential => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Refused(`factory credential ${path} is not valid JSON`);
  }
  const parsed = FactoryCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Refused(`factory credential ${path} has an invalid shape`);
  }
  return parsed.data;
};

export const createFactoryCredentialStore = (
  path: string,
): CredentialStorePort => ({
  read: () => (existsSync(path) ? parseFile(path) : null),
});
