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

export const RUNNER_NAMES: readonly string[] = ADAPTERS.map(
  (adapter) => adapter.name,
);

export const getRunner = (name: string): RunnerAdapter | undefined =>
  BY_NAME.get(name);
