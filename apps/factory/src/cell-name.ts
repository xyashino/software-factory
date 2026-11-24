const FALLBACK_CELL_NAME = 'cell';

export const cellNameOf = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK_CELL_NAME;
};
