import { antigravityRunner } from './antigravity';
import { claudeRunner } from './claude';
import { codexRunner } from './codex';
import { cursorRunner } from './cursor';
import { opencodeRunner } from './opencode';
import type { RunnerAdapter } from './runner';

const ADAPTERS: readonly RunnerAdapter[] = [
  claudeRunner,
  codexRunner,
  cursorRunner,
  antigravityRunner,
  opencodeRunner,
];

const BY_NAME = new Map(ADAPTERS.map((adapter) => [adapter.name, adapter]));

/** Every runner name with an adapter, in registration order. */
export const RUNNER_NAMES: readonly string[] = ADAPTERS.map(
  (adapter) => adapter.name,
);

export const getRunner = (name: string): RunnerAdapter | undefined => {
  return BY_NAME.get(name);
};

/** Runner names used by a workflow that have no adapter. Empty when all are registered. */
export const unregisteredRunners = (names: readonly string[]): string[] => {
  return names.filter((name) => !BY_NAME.has(name));
};
