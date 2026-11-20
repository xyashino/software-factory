const NON_SLUG_CHARS = /[^a-z0-9-]+/g;
const EDGE_DASHES = /^-+|-+$/g;
const GIT_SUFFIX = /\.git$/;

const toSlug = (text: string): string =>
  text.toLowerCase().replace(NON_SLUG_CHARS, '-').replace(EDGE_DASHES, '');

const lastSegment = (remote: string): string =>
  (remote.split(/[/:]/).pop() ?? '').replace(GIT_SUFFIX, '');

export const defaultProjectId = (
  remote: string | null,
  dirName: string,
): string => {
  const fromRemote = remote === null ? '' : toSlug(lastSegment(remote));
  return fromRemote !== '' ? fromRemote : toSlug(dirName);
};
