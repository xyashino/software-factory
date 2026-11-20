import { CELL_SERVER_MARKER, SERVER_MARKER, WEB_MARKER } from '../config';

export const dispatchInternal = async (
  args: readonly string[],
): Promise<boolean> => {
  const [marker, ...rest] = args;
  if (marker === SERVER_MARKER) {
    process.argv = [...process.argv.slice(0, 2), ...rest];
    await import('../../../factory-server/src/index');
    return true;
  }
  if (marker === CELL_SERVER_MARKER) {
    await import('../../../cell-server/src/index');
    return true;
  }
  const [entry] = rest;
  if (marker === WEB_MARKER && entry !== undefined) {
    await import(entry);
    return true;
  }
  return false;
};
