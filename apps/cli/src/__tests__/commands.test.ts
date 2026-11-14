import { describe, expect, it } from 'vitest';
import { adminCommand } from '../commands/admin';
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

  it('documents admin operations and sync in usage', () => {
    expect(usage).toContain('factory admin backup <file>');
    expect(usage).toContain('factory admin export <file>');
    expect(usage).toContain('factory admin rebuild-projections');
    expect(usage).toContain('factory sync');
  });
});
