import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTokenFile } from '../../../../src/adapters/fs/token-file';

const ENV_TOKEN = 'FACTORY_TOKEN';

let savedEnv: string | undefined;

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'factory-token-'));

const writeToken = (path: string, content: string): string => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
};

beforeEach(() => {
  savedEnv = process.env[ENV_TOKEN];
  delete process.env[ENV_TOKEN];
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env[ENV_TOKEN];
  } else {
    process.env[ENV_TOKEN] = savedEnv;
  }
});

describe('supervisor token lookup', () => {
  it('env token overrides token files', async () => {
    // Arrange
    const dir = tempDir();
    const repo = writeToken(join(dir, 'repo'), 'repo-token\n');
    const home = writeToken(join(dir, 'home'), 'home-token\n');
    process.env[ENV_TOKEN] = 'env-token';
    const tokens = createTokenFile([repo, home]);

    // Act
    const secret = await tokens.secret();

    // Assert
    expect(secret).toBe('env-token');
  });

  it('repo token overrides home token', async () => {
    // Arrange
    const dir = tempDir();
    const repo = writeToken(join(dir, 'repo'), 'repo-token\n');
    const home = writeToken(join(dir, 'home'), 'home-token\n');
    const tokens = createTokenFile([repo, home]);

    // Act
    const secret = await tokens.secret();

    // Assert
    expect(secret).toBe('repo-token');
  });

  it('empty repo token falls back to home token', async () => {
    // Arrange
    const dir = tempDir();
    const repo = writeToken(join(dir, 'repo'), '  \n');
    const home = writeToken(join(dir, 'home'), 'home-token\n');
    const tokens = createTokenFile([repo, home]);

    // Act
    const secret = await tokens.secret();

    // Assert
    expect(secret).toBe('home-token');
  });

  it('missing repo token falls back to home token', async () => {
    // Arrange
    const dir = tempDir();
    const repo = join(dir, 'missing');
    const home = writeToken(join(dir, 'home'), 'home-token\n');
    const tokens = createTokenFile([repo, home]);

    // Act
    const secret = await tokens.secret();

    // Assert
    expect(secret).toBe('home-token');
  });

  it('no token when every file is missing or empty', async () => {
    // Arrange
    const dir = tempDir();
    const repo = writeToken(join(dir, 'repo'), '');
    const home = join(dir, 'missing');
    const tokens = createTokenFile([repo, home]);

    // Act
    const secret = await tokens.secret();
    const access = await tokens.read();

    // Assert
    expect(secret).toBeNull();
    expect(access).toBeNull();
  });

  it('write saves the token to the first path with owner-only mode', async () => {
    // Arrange
    const dir = tempDir();
    const repo = join(dir, 'nested', 'repo');
    const home = join(dir, 'home');
    const tokens = createTokenFile([repo, home]);

    // Act
    await tokens.write('new-token');

    // Assert
    expect(readFileSync(repo, 'utf8')).toBe('new-token\n');
    expect(statSync(repo).mode & 0o777).toBe(0o600);
    expect(await tokens.secret()).toBe('new-token');
  });
});
