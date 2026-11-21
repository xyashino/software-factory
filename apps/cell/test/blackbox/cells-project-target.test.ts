import { describe, expect, it } from 'vitest';
import { createTestApp, postJson, type TestContext } from '../support/test-app';
import { WORKSPACE_ROOT } from '../support/fakes';

const JOIN_SECRET = 'join-secret-project-target';
const SUPERVISOR_SECRET = 'supervisor-secret-project-target';
const PROJECT = {
  projectId: 'app',
  repoUrl: 'https://example.test/app.git',
  defaultBaseBranch: 'main',
};

const setup = async (): Promise<TestContext> => {
  const context = createTestApp();
  await postJson(context.app, '/api/v1/factories', {
    name: 'local',
    url: 'http://127.0.0.1:7070',
    joinToken: JOIN_SECRET,
    supervisorToken: SUPERVISOR_SECRET,
  });
  return context;
};

describe('cell provisioning by project id', () => {
  it('provisions a workspace for a registered project when no repoRoot is sent', async () => {
    const context = await setup();
    context.factoryClient.addProject(PROJECT);
    context.repoInspector.addRepo(`${WORKSPACE_ROOT}/app`, {
      projectId: 'app',
      lines: ['main'],
    });

    const response = await postJson(context.app, '/api/v1/cells', {
      projectId: 'app',
    });

    expect(response.status).toBe(201);
    expect(context.workspace.ensures).toEqual([
      { projectId: 'app', repoUrl: PROJECT.repoUrl },
    ]);
    expect(context.factoryClient.enrolls[0]?.request.projectId).toBe('app');
  });

  it('refuses a project id that the factory does not know, with the sf project add hint', async () => {
    const context = await setup();

    const response = await postJson(context.app, '/api/v1/cells', {
      projectId: 'ghost',
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('sf project add ghost');
    expect(context.workspace.ensures).toEqual([]);
  });

  it('answers 400 when neither repoRoot nor projectId is sent', async () => {
    const context = await setup();

    const response = await postJson(context.app, '/api/v1/cells', {
      count: 1,
    });

    expect(response.status).toBe(400);
  });

  it('answers 409 when the repo at the path belongs to another project', async () => {
    const context = await setup();
    context.factoryClient.addProject(PROJECT);
    context.repoInspector.addRepo('/work/other', {
      projectId: 'other',
      lines: ['main'],
    });

    const response = await postJson(context.app, '/api/v1/cells', {
      repoRoot: '/work/other',
      projectId: 'app',
    });

    expect(response.status).toBe(409);
    expect(context.factoryClient.enrolls).toEqual([]);
  });
});
