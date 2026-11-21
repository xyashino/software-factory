import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTokenFile } from '../../../../src/adapters/fs/token-file';
import type { Connection } from '../../../../src/domain/connection/connection-config';

const connectedWith = (token: string | null): Connection => ({
  url: 'http://127.0.0.1:7070',
  urlSource: 'default',
  token,
  tokenSource: token === null ? null : 'env:FACTORY_TOKEN',
});

describe('supervisor token store', () => {
  it('serves the token of the resolved connection', async () => {
    // Arrange
    const tokens = createTokenFile(connectedWith('resolved-token'), '/unused');

    // Act
    const secret = await tokens.secret();
    const access = await tokens.read();

    // Assert
    expect(secret).toBe('resolved-token');
    expect(access).toEqual({ kind: 'supervisor' });
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
    const repo = join(dir, 'nested', 'supervisor.token');
    const tokens = createTokenFile(connectedWith(null), repo);

    // Act
    await tokens.write('new-token');

    // Assert
    expect(readFileSync(repo, 'utf8')).toBe('new-token\n');
    expect(statSync(repo).mode & 0o777).toBe(0o600);
  });
});
