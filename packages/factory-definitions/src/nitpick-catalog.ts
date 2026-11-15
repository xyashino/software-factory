import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** The output directory nitpick writes to when the config names none (`packages/nitpick/src/docs.ts`). */
const DEFAULT_OUTPUT = '.agents';

/** Where skills live in the repo when nitpick does not sync them into the output directory. */
const SKILLS_SOURCE = '.nitpick/skills';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
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

/**
 * The primary output directory, repo-relative. Null when the config points
 * outside the repo (absolute or `..`): no path is then published for it.
 */
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

/**
 * Rule id -> `<output>/rules/<file>.md`, as nitpick writes it: a rule whose
 * `doc` is an instruction object gets its own file, every other rule and each
 * group key share the group's file.
 */
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
      const standalone = isRecord(unit) && isRecord(unit['doc']);
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

/**
 * Skill id -> the `SKILL.md` path: `<output>/skills/<id>/SKILL.md` for a skill
 * nitpick syncs (listed in the config), else `.nitpick/skills/<id>/SKILL.md`.
 * Only ids with a file on disk are included.
 */
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
