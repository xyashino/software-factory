import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createTokenFile,
  repoTokenPathOf,
} from '../../../../src/adapters/fs/token-file';
import type { Connection } from '../../../../src/domain/connection/connection-config';

const LEGACY_PATH = '.factory-local/supervisor.token';
const OPERATOR_PATH = '.factory-local/operator.token';

const repoWithTokenFiles = (files: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-token-path-'));
  mkdirSync(join(dir, '.factory-local'), { recursive: true });
  for (const file of files) {
    writeFileSync(join(dir, file), 'stored-token\n');
  }
  return dir;
};

const connectedWith = (token: string | null): Connection => ({
  url: 'http://127.0.0.1:7070',
  urlSource: 'default',
  token,
  tokenSource: token === null ? null : 'env:FACTORY_TOKEN',
});

describe('operator token store', () => {
  it('serves the token of the resolved connection', async () => {
    // Arrange
    const tokens = createTokenFile(connectedWith('resolved-token'), '/unused');

    // Act
    const secret = await tokens.secret();
    const access = await tokens.read();

    // Assert
    expect(secret).toBe('resolved-token');
    expect(access).toEqual({ kind: 'operator' });
  });

  it('reports no token when the connection has none', async () => {
    // Arrange
    const tokens = createTokenFile(connectedWith(null), '/unused');

    // Act
    const secret = await tokens.secret();
    const access = await tokens.read();

    // Assert
    expect(secret).toBeNull();
    expect(access).toBeNull();
  });

  it('write saves the token to the repo token path with owner-only mode', async () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), 'factory-token-'));
    const repo = join(dir, 'nested', 'operator.token');
    const tokens = createTokenFile(connectedWith(null), repo);

    // Act
    await tokens.write('new-token');

    // Assert
    expect(readFileSync(repo, 'utf8')).toBe('new-token\n');
    expect(statSync(repo).mode & 0o777).toBe(0o600);
  });
});

describe('repo token path', () => {
  it('reads the operator token when it is the only token file', () => {
    // Arrange
    const dir = repoWithTokenFiles([OPERATOR_PATH]);

    // Act
    const path = repoTokenPathOf(dir);

    // Assert
    expect(path).toBe(OPERATOR_PATH);
  });

  it('reads the legacy supervisor token when the operator token is missing', () => {
    // Arrange
    const dir = repoWithTokenFiles([LEGACY_PATH]);

    // Act
    const path = repoTokenPathOf(dir);

    // Assert
    expect(path).toBe(LEGACY_PATH);
  });

  it('prefers the operator token when both token files exist', () => {
    // Arrange
    const dir = repoWithTokenFiles([LEGACY_PATH, OPERATOR_PATH]);

    // Act
    const path = repoTokenPathOf(dir);

    // Assert
    expect(path).toBe(OPERATOR_PATH);
  });

  it('keeps the legacy token file in place after it is read', () => {
    // Arrange
    const dir = repoWithTokenFiles([LEGACY_PATH]);

    // Act
    repoTokenPathOf(dir);

    // Assert
    expect(existsSync(join(dir, LEGACY_PATH))).toBe(true);
    expect(existsSync(join(dir, OPERATOR_PATH))).toBe(false);
  });
});
