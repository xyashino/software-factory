import { FACTORY_DAEMON_MARKER, HQ_MARKER, WEB_MARKER } from '../config';

export const dispatchInternal = async (
  args: readonly string[],
): Promise<boolean> => {
  const [marker, ...rest] = args;
  if (marker === HQ_MARKER) {
    process.argv = [...process.argv.slice(0, 2), ...rest];
    await import('../../../hq/src/index');
    return true;
  }
  if (marker === FACTORY_DAEMON_MARKER) {
    await import('../../../factory/src/index');
    return true;
  }
  const [entry] = rest;
  if (marker === WEB_MARKER && entry !== undefined) {
    await import(entry);
    return true;
  }
  return false;
};
