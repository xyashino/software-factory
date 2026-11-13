import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { DefinitionError } from './errors';
import type { NitpickCatalog } from './nitpick-catalog';
import type { OperatorProfile } from './operator-profile';

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Checks that every rule a profile declares is a rule or group in
 * `.nitpick/config.ts`, and every skill has `.nitpick/skills/<id>/SKILL.md`.
 * Only run when a catalog is given.
 */
export const validateOperatorCatalog = (
  file: string,
  profile: OperatorProfile,
  catalog: NitpickCatalog,
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
  profile.rules.forEach((id, index) => {
    if (!catalog.ruleIds.has(id)) {
      errors.push({
        file,
        field: `rules[${index}]`,
        message: `no rule ${id} in .nitpick/config.ts rules`,
      });
    }
  });
  profile.skills.forEach((id, index) => {
    if (!isFile(join(catalog.skillsDir, id, 'SKILL.md'))) {
      errors.push({
        file,
        field: `skills[${index}]`,
        message: `no skill file .nitpick/skills/${id}/SKILL.md`,
      });
    }
  });
  return errors;
};
