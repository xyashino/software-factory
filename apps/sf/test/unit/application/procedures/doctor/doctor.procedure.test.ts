import { describe, expect, it } from 'vitest';
import type { Ports } from '../../../../../src/application/core/procedure';
import {
  runDoctor,
  type DoctorCheck,
  type DoctorResult,
} from '../../../../../src/application/procedures/doctor/doctor.procedure';
import type { Access } from '../../../../../src/domain/access';
import { createFakePorts } from '../../../../support/fake-ports';

const REPO = '/repo';
const CONFIG_PATH = `${REPO}/.factory/config.json`;
const LINES_DIR = `${REPO}/.factory/lines`;
const DATA_DIR = '/data/sf';
const DB_PATH = '/data/sf/factory.db';
const PROJECT = 'software-factory';
const SECRET = 'top-secret-token';
const SUPERVISOR: Access = { kind: 'supervisor' };

const INPUT = {
  repoRoot: REPO,
  repoConfigPath: CONFIG_PATH,
  linesDir: LINES_DIR,
  dataDir: DATA_DIR,
  dbPath: DB_PATH,
};

interface Machine {
  lines: Record<string, string>;
  installed: string[];
  missing: string[];
  ghAuthenticated: boolean;
  serverUp: boolean;
  secret: string | null;
  projects: string[];
  rejectToken: boolean;
}

const lineYaml = (name: string, runner: string, headless = true): string =>
  [
    `name: ${name}`,
    'stations:',
    '  - id: build',
    '    kind: operator',
    '    operator: builder',
    'operators:',
    '  builder:',
    '    profile: builder',
    `    runner: ${runner}`,
    `    headless: ${headless}`,
    '',
  ].join('\n');

const healthy = (overrides: Partial<Machine> = {}): Machine => ({
  lines: { 'fast.yml': lineYaml('fast', 'claude') },
  installed: ['claude'],
  missing: [],
  ghAuthenticated: true,
  serverUp: true,
  secret: SECRET,
  projects: [PROJECT],
  rejectToken: false,
  ...overrides,
});

const doctorOn = (machine: Machine): Promise<DoctorResult> => {
  const fake = createFakePorts({
    secret: machine.secret,
    reply: () => {
      if (machine.rejectToken) {
        throw new Error('401 unauthorized');
      }
      return {
        code: 200,
        projects: machine.projects.map((projectId) => ({
          projectId,
          repoUrl: 'https://example.test/repo.git',
          defaultBaseBranch: 'main',
          maxRunning: 5,
          createdAt: 1,
          updatedAt: 1,
        })),
      };
    },
  });
  const files = new Map<string, string>([
    [CONFIG_PATH, JSON.stringify({ project: PROJECT })],
    ...Object.entries(machine.lines).map(([file, yaml]): [string, string] => [
      `${LINES_DIR}/${file}`,
      yaml,
    ]),
  ]);
  const ports: Ports = {
    ...fake.ports,
    server: {
      ...fake.ports.server,
      probe: async () => machine.serverUp,
    },
    runners: {
      ...fake.ports.runners,
      isInstalled: async (name) => machine.installed.includes(name),
    },
    process: {
      ...fake.ports.process,
      run: async (command) => ({
        exitCode: machine.missing.includes(command)
          ? 127
          : command === 'gh' && !machine.ghAuthenticated
            ? 1
            : 0,
        stdout: '',
        stderr: '',
      }),
    },
    fs: {
      ...fake.ports.fs,
      exists: async () => true,
      list: async () => Object.keys(machine.lines),
      readText: async (path) => {
        const text = files.get(path);
        if (text === undefined) {
          throw new Error('ENOENT');
        }
        return text;
      },
    },
  };
  return runDoctor.execute(INPUT, {
    ...ports,
    token: SUPERVISOR,
    principal: SUPERVISOR,
  });
};

const findCheck = (result: DoctorResult, name: string): DoctorCheck => {
  const found = result.checks.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`no check named ${name}`);
  }
  return found;
};

describe('sf doctor', () => {
  it('reports a machine with everything in place as ok', async () => {
    // Arrange
    const machine = healthy();

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.checks.map((item) => item.status)).not.toContain('missing');
  });

  it('names the line that needs a missing runner and how to install it', async () => {
    // Arrange
    const machine = healthy({ installed: [] });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(result.ok).toBe(false);
    expect(findCheck(result, 'runner:claude')).toMatchObject({
      status: 'missing',
      detail: expect.stringContaining('line fast'),
      fix: expect.stringContaining('claude'),
    });
  });

  it('requires herdr only when a line runs with headless false', async () => {
    // Arrange
    const machine = healthy({
      lines: { 'fast.yml': lineYaml('fast', 'claude', false) },
      missing: ['herdr'],
    });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(result.ok).toBe(false);
    expect(findCheck(result, 'herdr').status).toBe('missing');
  });

  it('skips herdr when every line runs headless', async () => {
    // Arrange
    const machine = healthy({ missing: ['herdr'] });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(result.checks.map((item) => item.name)).not.toContain('herdr');
    expect(result.ok).toBe(true);
  });

  it('reports a server that does not answer with a start hint', async () => {
    // Arrange
    const machine = healthy({ serverUp: false });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(findCheck(result, 'server')).toMatchObject({
      status: 'missing',
      fix: 'start it with sf hq start',
    });
    expect(result.ok).toBe(false);
  });

  it('never prints the stored token', async () => {
    // Arrange
    const machine = healthy();

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('reports a rejected token with the command that repairs it', async () => {
    // Arrange
    const machine = healthy({ rejectToken: true });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(findCheck(result, 'token')).toMatchObject({
      status: 'missing',
      fix: 'sf hq token admin create --save --global',
    });
    expect(result.ok).toBe(false);
  });

  it('reports a repo project the server does not know with the add command', async () => {
    // Arrange
    const machine = healthy({ projects: [] });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(findCheck(result, 'project')).toMatchObject({
      status: 'missing',
      fix: `sf project add ${PROJECT} --repo <repo url>`,
    });
  });

  it('treats a missing gh login as a warning that does not fail the check', async () => {
    // Arrange
    const machine = healthy({ ghAuthenticated: false });

    // Act
    const result = await doctorOn(machine);

    // Assert
    expect(findCheck(result, 'gh').status).toBe('warn');
    expect(result.ok).toBe(true);
  });
});
