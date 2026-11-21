const CELL_DIR = '.cell';
const DEFAULT_MESSAGE = 'chore(factory): checkpoint';

export const checkpointPaths = (producedFiles: readonly string[]): string[] => [
  ...new Set(
    producedFiles.filter(
      (path) =>
        path.length > 0 &&
        path !== CELL_DIR &&
        !path.startsWith(`${CELL_DIR}/`),
    ),
  ),
];

export const checkpointMessage = (
  commitText: string | undefined,
  slug: string,
): string => {
  const text = commitText?.trim();
  return text ? text : `${DEFAULT_MESSAGE} ${slug}`;
};
