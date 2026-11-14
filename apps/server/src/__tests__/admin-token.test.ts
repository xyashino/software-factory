import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@repo/factory-core/ids';
import { openRuntime } from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { runAdminCommand } from '../admin-command';

const PROJECT = 'software-factory' as ProjectId;

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-token-'));
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('admin token create', () => {
  it('prints a supervisor token once and stores only its hash', async () => {
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line);
    });

    const code = await runAdminCommand(['token', 'create', 'dev'], dataDir);

    expect(code).toBe(0);
    const { name, token } = JSON.parse(printed[0] ?? '{}') as {
      name: string;
      token: string;
    };
    expect(name).toBe('dev');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const opened = openRuntime({ dataDir });
    try {
      expect(await opened.runtime.remote.supervisorName(token)).toBe('dev');
    } finally {
      opened.close();
    }
    const database = readFileSync(join(dataDir, 'factory.db'));
    expect(database.includes(Buffer.from(token))).toBe(false);
  });

  it('answers a missing name with usage and exit code 2', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });

    const code = await runAdminCommand(['token', 'create'], dataDir);

    expect(code).toBe(2);
    expect(errors.join('\n')).toContain('admin token create <name>');
  });
});
