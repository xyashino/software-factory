import { describe, expect, it } from 'vitest';
import { Refused, Unauthorized } from '../../../src/application/core/errors';
import { connectTarget } from '../../../src/application/procedures/connection/connect.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const TOKEN = 'sup_connect_secret';
const REMOTE = 'https://factory.example/';

const accepting = () =>
  createFakePorts({ reply: () => ({ code: 200, projects: [] }) });

describe('connect', () => {
  it('probes the projects route with the given token before saving', async () => {
    // Arrange
    const fake = accepting();

    // Act
    await runProcedure(
      connectTarget,
      { url: REMOTE, token: TOKEN, default: false },
      fake,
    );

    // Assert
    expect(fake.calls).toEqual([
      {
        method: 'GET',
        route: '/api/v1/projects',
        query: {},
        token: TOKEN,
      },
    ]);
  });

  it('saves the target without the trailing slash and makes it active when none is set', async () => {
    // Arrange
    const fake = accepting();

    // Act
    const result = await runProcedure(
      connectTarget,
      { url: REMOTE, token: TOKEN, default: false },
      fake,
    );

    // Assert
    expect(result).toEqual({
      name: 'factory-example',
      url: 'https://factory.example',
      active: true,
    });
    expect(fake.savedConnections).toEqual([
      {
        current: 'factory-example',
        targets: {
          'factory-example': { url: 'https://factory.example', token: TOKEN },
        },
      },
    ]);
  });

  it('keeps the active target when connecting without default', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({ code: 200, projects: [] }),
      connectionConfig: {
        current: 'local',
        targets: {
          local: { url: 'http://127.0.0.1:7070', token: 'sup_local' },
        },
      },
    });

    // Act
    const result = await runProcedure(
      connectTarget,
      { url: REMOTE, name: 'remote', token: TOKEN, default: false },
      fake,
    );

    // Assert
    expect(result.active).toBe(false);
    expect(fake.savedConnections[0]?.current).toBe('local');
    expect(fake.savedConnections[0]?.targets.remote?.token).toBe(TOKEN);
  });

  it('never returns the token in the result', async () => {
    // Arrange
    const fake = accepting();

    // Act
    const result = await runProcedure(
      connectTarget,
      { url: REMOTE, token: TOKEN, default: true },
      fake,
    );

    // Assert
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('refuses a token the factory rejects and saves nothing', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => {
        throw new Unauthorized('401: Missing or invalid bearer token');
      },
    });

    // Act
    const attempt = runProcedure(
      connectTarget,
      { url: REMOTE, token: TOKEN, default: true },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toThrow(Refused);
    expect(fake.savedConnections).toEqual([]);
  });
});
