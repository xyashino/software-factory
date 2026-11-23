import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Refused } from '../../application/core/errors';
import type { FactoryCredentialPort } from '../../application/ports/factory-credential.port';
import {
  FactoryCredentialSchema,
  type FactoryCredential,
} from '../../domain/factory/factory-credential';

const CREDENTIAL_MODE = 0o600;
const DIR_MODE = 0o700;

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
): FactoryCredentialPort => ({
  read: () => (existsSync(path) ? parseFile(path) : null),
  write: (credential) => {
    const text = `${JSON.stringify(FactoryCredentialSchema.parse(credential), null, 2)}\n`;
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
    const staging = `${path}.tmp-${process.pid}`;
    writeFileSync(staging, text, { mode: CREDENTIAL_MODE });
    chmodSync(staging, CREDENTIAL_MODE);
    renameSync(staging, path);
  },
});
