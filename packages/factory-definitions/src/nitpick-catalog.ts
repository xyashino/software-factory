import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseYaml, splitFrontmatter } from './frontmatter';

/**
 * What an operator profile may declare: rule ids and the directory holding `<id>/SKILL.md`. `rulePaths` and
 * `skillPaths` map each id to its repo-relative markdown file, so a prompt can name where the text lives.
 */
export interface NitpickCatalog {
  ruleIds: ReadonlySet<string>;
  skillsDir: string;
  rulePaths: ReadonlyMap<string, string>;
  skillPaths: ReadonlyMap<string, string>;
}

/**
 * Shape of `.factory/config.json`.
 * Allows pointing to rules and skills base directories in any repository.
 */
export interface FactoryConfig {
  rules?: string;
  skills?: string;
}

const DEFAULT_OUTPUT = '.agents';

// Where skills live in the repo when nitpick does not sync them into the output directory.
const SKILLS_SOURCE = '.nitpick/skills';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/** Reads `.factory/config.json` if it exists. */
export const readFactoryConfig = (
  factoryRoot: string,
): FactoryConfig | undefined => {
  const configFile = join(factoryRoot, 'config.json');
  if (!existsSync(configFile)) return undefined;
  try {
    const content = readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return undefined;
    return {
      ...(typeof parsed['rules'] === 'string'
        ? { rules: parsed['rules'] }
        : {}),
      ...(typeof parsed['skills'] === 'string'
        ? { skills: parsed['skills'] }
        : {}),
    };
  } catch {
    return undefined;
  }
};

/** Builds a catalog by scanning the base paths declared in `.factory/config.json`. */
export const catalogFromConfig = (
  root: string,
  config: FactoryConfig,
): NitpickCatalog => {
  const skillPaths = new Map<string, string>();
  const skillsRel = config.skills
    ? posix.normalize(config.skills.replaceAll('\\', '/'))
    : '.factory/skills';
  const skillsDir = join(root, skillsRel);

  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        if (isSkillFile(skillFile)) {
          skillPaths.set(
            entry.name,
            posix.join(skillsRel, entry.name, 'SKILL.md'),
          );
        }
      }
    }
  } catch {
    // skillsDir does not exist or cannot be read
  }

  const ruleIds = new Set<string>();
  const rulePaths = new Map<string, string>();
  const rulesRel = config.rules
    ? posix.normalize(config.rules.replaceAll('\\', '/'))
    : '.factory/rules';
  const rulesDir = join(root, rulesRel);

  const walkRules = (currentDir: string, relPrefix: string): void => {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const nextRel = relPrefix
          ? posix.join(relPrefix, entry.name)
          : entry.name;
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          ruleIds.add(entry.name);
          ruleIds.add(nextRel);
          walkRules(fullPath, nextRel);
          const resolveDirTarget = (): string => {
            const groupFile = posix.join(rulesRel, `${nextRel}.md`);
            return existsSync(join(root, groupFile))
              ? groupFile
              : posix.join(rulesRel, nextRel);
          };
          const target = resolveDirTarget();
          if (!rulePaths.has(entry.name)) {
            rulePaths.set(entry.name, target);
          }
          if (!rulePaths.has(nextRel)) {
            rulePaths.set(nextRel, target);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const id = basename(entry.name, '.md');
          const relId = nextRel.slice(0, -3);
          ruleIds.add(id);
          ruleIds.add(relId);
          rulePaths.set(id, posix.join(rulesRel, nextRel));
          rulePaths.set(relId, posix.join(rulesRel, nextRel));
          try {
            const content = readFileSync(fullPath, 'utf8');
            const split = splitFrontmatter(content);
            if (split !== null) {
              const parsed = parseYaml(nextRel, split.frontmatter);
              if (
                parsed.ok &&
                isRecord(parsed.value) &&
                typeof parsed.value['id'] === 'string'
              ) {
                ruleIds.add(parsed.value['id']);
                rulePaths.set(
                  parsed.value['id'],
                  posix.join(rulesRel, nextRel),
                );
              }
            }
          } catch {
            // ignore malformed frontmatter
          }
        }
      }
    } catch {
      // rulesDir does not exist
    }
  };

  walkRules(rulesDir, '');

  return {
    ruleIds,
    skillsDir,
    rulePaths,
    skillPaths,
  };
};

/**
 * Reads the rules and skills declared in `.factory/config.json` (if configured and existing)
 * or `.nitpick/config.ts`. Returns `undefined` when neither exists.
 */
export const resolveCatalog = async (
  root: string,
): Promise<NitpickCatalog | undefined> => {
  const factoryConfig = readFactoryConfig(join(root, '.factory'));
  if (factoryConfig && (factoryConfig.rules || factoryConfig.skills)) {
    const hasRules =
      !factoryConfig.rules || existsSync(join(root, factoryConfig.rules));
    const hasSkills =
      !factoryConfig.skills || existsSync(join(root, factoryConfig.skills));
    if (hasRules && hasSkills) {
      return catalogFromConfig(root, factoryConfig);
    }
  }

  const nitpickFile = join(root, '.nitpick', 'config.ts');
  if (existsSync(nitpickFile)) {
    return nitpickCatalog(root);
  }

  return undefined;
};

/**
 * Collects the rule ids a nitpick config declares: every group key and every
 * rule key inside a group. Profiles may name either (`testing` is a group).
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

// The primary output directory, repo-relative. Null when the config points
// outside the repo (absolute or `..`): no path is then published for it.
const outputDirOf = (config: Record<string, unknown>): string | null => {
  const output = config['output'];
  const first = Array.isArray(output) ? output[0] : undefined;
  const configured =
    isRecord(first) && typeof first['path'] === 'string'
      ? first['path']
      : DEFAULT_OUTPUT;
  const dir = posix.normalize(configured.replaceAll('\\', '/'));
  if (isAbsolute(dir) || dir === '..' || dir.startsWith('../')) return null;
  return dir;
};

const rulePathsOf = (
  config: Record<string, unknown>,
  outDir: string,
): Map<string, string> => {
  const paths = new Map<string, string>();
  if (!isRecord(config['rules'])) return paths;
  for (const [group, units] of Object.entries(config['rules'])) {
    const groupFile = posix.join(outDir, 'rules', `${group}.md`);
    paths.set(group, groupFile);
    if (!isRecord(units)) continue;
    for (const [id, unit] of Object.entries(units)) {
      const standalone =
        isRecord(unit) &&
        isRecord(unit['doc']) &&
        !('inline' in unit['doc'] && unit['doc']['inline']);
      paths.set(
        id,
        standalone ? posix.join(outDir, 'rules', `${id}.md`) : groupFile,
      );
    }
  }
  return paths;
};

const isSkillFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// Skill id -> the `SKILL.md` path: `<output>/skills/<id>/SKILL.md` for a skill
// nitpick syncs (listed in the config), else `.nitpick/skills/<id>/SKILL.md`.
// Only ids with a file on disk are included.
const skillPathsOf = (
  config: Record<string, unknown>,
  root: string,
  outDir: string,
): Map<string, string> => {
  const synced = isRecord(config['skills']) ? config['skills'] : {};
  const ids = new Set(Object.keys(synced));
  try {
    for (const entry of readdirSync(join(root, SKILLS_SOURCE), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // no .nitpick/skills directory: only the synced skills can resolve
  }
  const paths = new Map<string, string>();
  for (const id of ids) {
    const relative = Object.hasOwn(synced, id)
      ? posix.join(outDir, 'skills', id, 'SKILL.md')
      : posix.join(SKILLS_SOURCE, id, 'SKILL.md');
    if (isSkillFile(join(root, relative))) paths.set(id, relative);
  }
  return paths;
};

/**
 * Loads the catalog from the repo's `.nitpick/` sources: rule ids from
 * `.nitpick/config.ts`, skills from `.nitpick/skills/`. The root is an
 * argument; nothing is guessed from the working directory.
 */
export const nitpickCatalog = async (root: string): Promise<NitpickCatalog> => {
  const configPath = join(root, '.nitpick', 'config.ts');
  const loaded: unknown = await import(pathToFileURL(configPath).href);
  const config = isRecord(loaded) ? loaded['default'] : undefined;
  const record = isRecord(config) ? config : {};
  const outDir = outputDirOf(record);
  return {
    ruleIds: readRuleIds(config),
    skillsDir: join(root, '.nitpick', 'skills'),
    rulePaths: outDir === null ? new Map() : rulePathsOf(record, outDir),
    skillPaths:
      outDir === null ? new Map() : skillPathsOf(record, root, outDir),
  };
};
