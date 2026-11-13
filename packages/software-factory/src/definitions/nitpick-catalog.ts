import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** What a role may declare: rule ids and the directory holding `<id>/SKILL.md`. */
export interface NitpickCatalog {
  ruleIds: ReadonlySet<string>;
  skillsDir: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Collects the rule ids a nitpick config declares: every group key and every
 * rule key inside a group. Roles may name either (`testing` is a group).
 */
export const readRuleIds = (config: unknown): Set<string> => {
  const ids = new Set<string>();
  if (!isRecord(config) || !isRecord(config['rules'])) {
    return ids;
  }
  for (const [group, units] of Object.entries(config['rules'])) {
    ids.add(group);
    if (isRecord(units)) {
      for (const id of Object.keys(units)) {
        ids.add(id);
      }
    }
  }
  return ids;
};

/**
 * Loads the catalog from the repo's `.nitpick/` sources: rule ids from
 * `.nitpick/config.ts`, skills from `.nitpick/skills/`.
 */
export const nitpickCatalog = async (root: string): Promise<NitpickCatalog> => {
  const configPath = join(root, '.nitpick', 'config.ts');
  const loaded: unknown = await import(pathToFileURL(configPath).href);
  const config = isRecord(loaded) ? loaded['default'] : undefined;
  return {
    ruleIds: readRuleIds(config),
    skillsDir: join(root, '.nitpick', 'skills'),
  };
};
