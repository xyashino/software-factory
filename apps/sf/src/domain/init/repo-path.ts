const TRAILING_SLASHES = /\/+$/;

export const repoPath = (root: string, relative: string): string =>
  `${root.replace(TRAILING_SLASHES, '')}/${relative}`;
