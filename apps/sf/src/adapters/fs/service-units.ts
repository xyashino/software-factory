import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { isManagedUnitText } from '../../domain/service/units';

const SECRET_MODE = 0o600;

export const readUnitIfManaged = (path: string): string | null => {
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, 'utf8');
  return isManagedUnitText(text) ? text : null;
};

export const isUnitTaken = (path: string): boolean => existsSync(path);

export const writeUnitFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

export const writeSecretEnvFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: SECRET_MODE });
  chmodSync(path, SECRET_MODE);
};

export const removeFileIfExists = (path: string): void => {
  rmSync(path, { force: true });
};

export const listUnitFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir) : [];
