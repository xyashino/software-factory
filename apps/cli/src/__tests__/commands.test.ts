import { describe, expect, it } from 'vitest';
import { adminCommand } from '../commands/admin';
import {
  parseDepPolicy,
  parseMaxRunning,
  projectCommand,
} from '../commands/project';
import { usage } from '../usage';

describe('factory admin command tree', () => {
  it('registers backup, export, import and rebuild-projections subcommands', () => {
    const subCommands = adminCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subCommands).sort()).toEqual([
      'backup',
      'export',
      'import',
      'rebuild-projections',
    ]);
  });

  it('documents the admin operations in usage, and no sync or recover', () => {
    expect(usage).toContain('factory admin backup <file>');
    expect(usage).toContain('factory admin export <file>');
    expect(usage).toContain('factory admin rebuild-projections');
    expect(usage).not.toContain('factory admin recover');
    expect(usage).not.toContain('factory sync');
  });
});

describe('factory project command tree', () => {
  it('registers ls, add, set and rm subcommands', () => {
    const subCommands = projectCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subCommands).sort()).toEqual(['add', 'ls', 'rm', 'set']);
  });

  it('documents the project commands in usage', () => {
    expect(usage).toContain('factory project ls');
    expect(usage).toContain('factory project add <id> --repo <url>');
    expect(usage).toContain('factory project set <id>');
    expect(usage).toContain('factory project rm <id>');
  });
});

describe('project flag values', () => {
  it('accepts delivered and merged as dependency policies', () => {
    expect(parseDepPolicy('delivered')).toBe('delivered');
    expect(parseDepPolicy('merged')).toBe('merged');
  });

  it('refuses any other dependency policy before a call is made', () => {
    expect(() => parseDepPolicy('shipped')).toThrow(/delivered or merged/);
  });

  it('reads --max-running as a whole number of one or more', () => {
    expect(parseMaxRunning('3')).toBe(3);
  });

  it.each(['0', '-1', '1.5', 'many', ''])(
    'refuses --max-running of "%s"',
    (text) => {
      expect(() => parseMaxRunning(text)).toThrow(/--max-running/);
    },
  );
});
