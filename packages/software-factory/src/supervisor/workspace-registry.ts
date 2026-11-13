import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkspaceRegistry } from './ports';

/** Keeps task -> Herdr workspace id in a JSON file, so a restart finds the same workspace. */
export class FileWorkspaceRegistry implements WorkspaceRegistry {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get(taskId: string): string | undefined {
    return this.load()[taskId];
  }

  set(taskId: string, workspaceId: string): void {
    const all = this.load();
    all[taskId] = workspaceId;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(all, null, 2));
  }

  delete(taskId: string): void {
    const all = this.load();
    if (!(taskId in all)) return;
    delete all[taskId];
    writeFileSync(this.path, JSON.stringify(all, null, 2));
  }

  private load(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return isStringRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

const isStringRecord = (value: unknown): value is Record<string, string> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((item) => typeof item === 'string')
  );
};
