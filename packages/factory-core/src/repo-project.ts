import { projectIdSchema, type ProjectId } from './ids';

/**
 * The project a repository runs as (PROTOCOL §3.1, §10): the first configured project when the Cell's
 * config names one, otherwise the repository's directory name normalized to a project id. The name is
 * lowercased, every run of characters outside `a-z0-9` becomes one `-`, and the ends are trimmed. A name
 * that normalizes to nothing valid is refused with the name in the message.
 */
export const repoProjectId = (
  directoryName: string,
  configured: readonly ProjectId[],
): ProjectId => {
  const first = configured[0];
  if (first !== undefined) return first;
  const normalized = directoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
    .replace(/-+$/g, '');
  const parsed = projectIdSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `repository directory "${directoryName}" gives no valid project id; set projects = ["<id>"] in the Cell's config`,
    );
  }
  return parsed.data;
};
