import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONNECTION_CONFIG,
  defaultTargetNameOf,
  recoveryCommandOf,
  resolveConnection,
  tokenFixOf,
  withoutTarget,
  type ConnectionConfig,
  type ConnectionInputs,
} from '../../../src/domain/connection/connection-config';

const DEFAULT_URL = 'http://127.0.0.1:7070';
const REMOTE_URL = 'https://factory.example';

const remoteConfig: ConnectionConfig = {
  current: 'remote',
  targets: { remote: { url: REMOTE_URL, token: 'config-token' } },
};

const inputsWith = (
  overrides: Partial<ConnectionInputs>,
): ConnectionInputs => ({
  envUrl: undefined,
  envToken: undefined,
  repoToken: undefined,
  legacyToken: undefined,
  config: EMPTY_CONNECTION_CONFIG,
  defaultUrl: DEFAULT_URL,
  ...overrides,
});

describe('connection resolution', () => {
  it('falls back to the default url and no token when nothing is configured', () => {
    // Arrange
    const inputs = inputsWith({});

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection).toEqual({
      url: DEFAULT_URL,
      urlSource: 'default',
      token: null,
      tokenSource: null,
    });
  });

  it('uses the active target url and token when no env is set', () => {
    // Arrange
    const inputs = inputsWith({ config: remoteConfig });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection).toEqual({
      url: REMOTE_URL,
      urlSource: 'config:remote',
      token: 'config-token',
      tokenSource: 'config:remote',
    });
  });

  it('lets HQ_URL override the active target url', () => {
    // Arrange
    const inputs = inputsWith({
      envUrl: { name: 'HQ_URL', value: 'http://10.0.0.5:7070' },
      config: remoteConfig,
    });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.url).toBe('http://10.0.0.5:7070');
    expect(connection.urlSource).toBe('env:HQ_URL');
  });

  it('lets HQ_TOKEN beat the repo and target tokens', () => {
    // Arrange
    const inputs = inputsWith({
      envToken: { name: 'HQ_TOKEN', value: 'env-token' },
      repoToken: 'repo-token',
      config: remoteConfig,
    });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.token).toBe('env-token');
    expect(connection.tokenSource).toBe('env:HQ_TOKEN');
  });

  it('names the FACTORY_TOKEN fallback as the token source', () => {
    // Arrange
    const inputs = inputsWith({
      envToken: { name: 'FACTORY_TOKEN', value: 'legacy-env-token' },
    });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.tokenSource).toBe('env:FACTORY_TOKEN');
    expect(tokenFixOf(connection)).toBe(
      'unset FACTORY_TOKEN, or set it to a token the server accepts',
    );
  });

  it('prefers the repo token over the active target token', () => {
    // Arrange
    const inputs = inputsWith({
      repoToken: 'repo-token',
      config: remoteConfig,
    });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.token).toBe('repo-token');
    expect(connection.tokenSource).toBe('repo:.factory-local/supervisor.token');
  });

  it('falls back to the legacy token when no other token exists', () => {
    // Arrange
    const inputs = inputsWith({ legacyToken: 'legacy-token' });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.token).toBe('legacy-token');
    expect(connection.tokenSource).toBe('legacy:~/.config/factory/token');
  });

  it('ignores blank env values', () => {
    // Arrange
    const inputs = inputsWith({
      envUrl: { name: 'HQ_URL', value: '   ' },
      envToken: { name: 'HQ_TOKEN', value: '' },
    });

    // Act
    const connection = resolveConnection(inputs);

    // Assert
    expect(connection.urlSource).toBe('default');
    expect(connection.token).toBeNull();
  });
});

describe('target edits', () => {
  it('clears the active target when it is removed', () => {
    // Arrange
    const config = remoteConfig;

    // Act
    const next = withoutTarget(config, 'remote');

    // Assert
    expect(next).toEqual(EMPTY_CONNECTION_CONFIG);
  });
});

describe('recovery hints', () => {
  it('suggests minting a global token for a loopback factory', () => {
    // Arrange
    const url = DEFAULT_URL;

    // Act
    const command = recoveryCommandOf(url);

    // Assert
    expect(command).toBe('sf hq token admin create --save --global');
  });

  it('suggests connecting again for a remote factory', () => {
    // Arrange
    const url = REMOTE_URL;

    // Act
    const command = recoveryCommandOf(url);

    // Assert
    expect(command).toBe(`sf connect ${REMOTE_URL}`);
  });

  it('names a loopback target local and a remote target after its host', () => {
    // Arrange
    const local = DEFAULT_URL;
    const remote = 'https://Factory.Example:8443';

    // Act
    const names = [defaultTargetNameOf(local), defaultTargetNameOf(remote)];

    // Assert
    expect(names).toEqual(['local', 'factory-example']);
  });
});
