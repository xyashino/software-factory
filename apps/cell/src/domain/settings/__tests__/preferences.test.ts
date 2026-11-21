import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../preferences';

describe('preference defaults', () => {
  it('defaults to the documented machine preferences', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      herdr_enabled: false,
      default_runner: 'claude',
      restart_backoff_ms: 1000,
      max_local_cells: 4,
      git_fetch_on_worktree: true,
    });
  });
});

describe('preference patch validation', () => {
  it('accepts a boolean for herdr_enabled', () => {
    expect(validateSettingsPatch({ herdr_enabled: true })).toEqual({
      herdr_enabled: true,
    });
  });

  it('rejects a string for herdr_enabled', () => {
    expect(() => validateSettingsPatch({ herdr_enabled: 'yes' })).toThrow(
      'herdr_enabled must be a boolean',
    );
  });

  it('accepts each known runner', () => {
    for (const runner of [
      'claude',
      'codex',
      'cursor',
      'antigravity',
      'opencode',
    ])
      expect(validateSettingsPatch({ default_runner: runner })).toEqual({
        default_runner: runner,
      });
  });

  it('rejects an unknown runner', () => {
    expect(() => validateSettingsPatch({ default_runner: 'gemini' })).toThrow(
      'default_runner must be one of',
    );
  });

  it('accepts the restart backoff bounds', () => {
    expect(validateSettingsPatch({ restart_backoff_ms: 0 })).toEqual({
      restart_backoff_ms: 0,
    });
    expect(validateSettingsPatch({ restart_backoff_ms: 600_000 })).toEqual({
      restart_backoff_ms: 600_000,
    });
  });

  it('rejects a restart backoff above its bound', () => {
    expect(() =>
      validateSettingsPatch({ restart_backoff_ms: 600_001 }),
    ).toThrow('restart_backoff_ms must be an integer from 0 to 600000');
  });

  it('rejects a fractional max_local_cells', () => {
    expect(() => validateSettingsPatch({ max_local_cells: 2.5 })).toThrow(
      'max_local_cells must be an integer from 0 to 64',
    );
  });

  it('rejects a max_local_cells above its bound', () => {
    expect(() => validateSettingsPatch({ max_local_cells: 65 })).toThrow(
      'max_local_cells must be an integer from 0 to 64',
    );
  });

  it('rejects a non-boolean git_fetch_on_worktree', () => {
    expect(() => validateSettingsPatch({ git_fetch_on_worktree: 1 })).toThrow(
      'git_fetch_on_worktree must be a boolean',
    );
  });

  it('rejects an unknown key', () => {
    expect(() => validateSettingsPatch({ host: '0.0.0.0' })).toThrow(
      'unknown setting: host',
    );
  });

  it('accepts an empty patch', () => {
    expect(validateSettingsPatch({})).toEqual({});
  });
});
