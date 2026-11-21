import { describe, expect, it } from 'vitest';
import { Unauthorized } from '../../../src/application/core/errors';
import type { Ports } from '../../../src/application/core/procedure';
import {
  doctor,
  type DoctorCheck,
  type DoctorResult,
} from '../../../src/application/procedures/doctor/doctor.procedure';
import type { Access } from '../../../src/domain/access';
import { createFakePorts, PROJECTS_REPLY } from '../../support/fake-ports';

const SUPERVISOR: Access = { kind: 'supervisor' };
const SECRET = 'secret-value';
const LINES_DIR = '/repo/.factory/lines';
const CONFIG_PATH = '/repo/.factory/config.json';
const DOCTOR_INPUT = {
  cwd: '/repo',
  linesDir: LINES_DIR,
  configPath: CONFIG_PATH,
  dataDir: '/data',
  dbPath: '/data/factory.db',
};
const HEADLESS_LINE = [
  'name: standard',
  'stations:',
  '  - id: build',
  '    kind: operator',
  '    operator: builder',
  'operators:',
  '  builder:',
  '    runner: claude',
  '',
].join('\n');
const HERDR_LINE = HEADLESS_LINE.replace(
  '    runner: claude',
  '    runner: claude\n    headless: false',
);

interface Machine {
  lines?: Record<string, string>;
  missingCommands?: string[];
  installedRunners?: string[];
  serverUp?: boolean;
  secret?: string | null;
  reply?: (call: { route: string }) => unknown;
  writable?: (path: string) => boolean;
}

const machine = (options: Machine = {}): Ports => {
  const lines = options.lines ?? { 'standard.yml': HEADLESS_LINE };
  const files: Record<string, string> = {
    [CONFIG_PATH]: JSON.stringify({ project: 'software-factory' }),
  };
  for (const [file, text] of Object.entries(lines)) {
    files[`${LINES_DIR}/${file}`] = text;
  }
  const fake = createFakePorts({
    secret: options.secret,
    reply: options.reply ?? (() => PROJECTS_REPLY),
  });
  const missing = options.missingCommands ?? [];
  const installed = options.installedRunners ?? ['claude'];
  return {
    ...fake.ports,
    server: {
      ...fake.ports.server,
      probe: async () => options.serverUp ?? true,
    },
    fs: {
      ...fake.ports.fs,
      readText: async (path) => {
        const text = files[path];
        if (text === undefined) throw new Error(`ENOENT ${path}`);
        return text;
      },
      list: async (dir) => (dir === LINES_DIR ? Object.keys(lines) : []),
      writable: async (path) => (options.writable ?? (() => true))(path),
    },
    runners: {
      ...fake.ports.runners,
      isInstalled: async (name) => installed.includes(name),
    },
    process: {
      ...fake.ports.process,
      run: async (command) => ({
        exitCode: missing.includes(command) ? 127 : 0,
        stdout: '',
        stderr: '',
      }),
    },
  };
};

const runDoctor = (ports: Ports): Promise<DoctorResult> =>
  doctor.execute(DOCTOR_INPUT, {
    ...ports,
    token: SUPERVISOR,
    principal: SUPERVISOR,
  });

const checkNamed = (
  result: DoctorResult,
  name: string,
): DoctorCheck | undefined =>
  result.checks.find((check) => check.name === name);

describe('sf doctor', () => {
  it('passes when every required check is ready', async () => {
    // Arrange
    const ports = machine();

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.checks.filter((check) => check.status === 'missing')).toEqual(
      [],
    );
  });

  it('names the line that needs a runner that is not installed', async () => {
    // Arrange
    const ports = machine({ installedRunners: [] });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(result.ok).toBe(false);
    expect(checkNamed(result, 'runner claude')).toMatchObject({
      status: 'missing',
      detail: 'needed by line standard',
    });
  });

  it('requires herdr only when a line is not headless', async () => {
    // Arrange
    const headless = machine({ missingCommands: ['herdr'] });
    const attached = machine({
      lines: { 'standard.yml': HERDR_LINE },
      missingCommands: ['herdr'],
    });

    // Act
    const headlessResult = await runDoctor(headless);
    const attachedResult = await runDoctor(attached);

    // Assert
    expect(checkNamed(headlessResult, 'herdr')).toBeUndefined();
    expect(headlessResult.ok).toBe(true);
    expect(checkNamed(attachedResult, 'herdr')).toMatchObject({
      status: 'missing',
      detail: 'needed by headless: false line standard',
    });
    expect(attachedResult.ok).toBe(false);
  });

  it('reports a rejected token with the recovery command and never prints it', async () => {
    // Arrange
    const ports = machine({
      reply: () => {
        throw new Unauthorized('invalid token');
      },
    });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(checkNamed(result, 'token')).toMatchObject({
      status: 'missing',
      detail: 'rejected by server',
      fix: 'sf server token create --save --global',
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('reports a stopped server with the start command', async () => {
    // Arrange
    const ports = machine({ serverUp: false });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(result.ok).toBe(false);
    expect(checkNamed(result, 'server')).toMatchObject({
      status: 'missing',
      fix: 'sf server start',
    });
    expect(checkNamed(result, 'token')?.status).toBe('warn');
  });

  it('reports a repo project id that is not registered on the server', async () => {
    // Arrange
    const ports = machine({ reply: () => ({ code: 200, projects: [] }) });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(checkNamed(result, 'project')).toMatchObject({
      status: 'missing',
      detail: 'software-factory is not registered on the server',
      fix: 'sf project add software-factory --repo <repo-url>',
    });
  });

  it('reports a db path that cannot be written', async () => {
    // Arrange
    const ports = machine({
      writable: (path) => path !== '/data/factory.db',
    });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(checkNamed(result, 'db path')).toMatchObject({
      status: 'missing',
      detail: '/data/factory.db is not writable',
    });
  });

  it('reports a line file that does not parse as its own failure', async () => {
    // Arrange
    const ports = machine({ lines: { 'broken.yml': 'name: [' } });

    // Act
    const result = await runDoctor(ports);

    // Assert
    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name.startsWith('line ')),
    ).toMatchObject({ status: 'missing' });
  });
});
