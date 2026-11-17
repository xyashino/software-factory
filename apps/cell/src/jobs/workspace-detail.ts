import { isMachineIndependentText } from '@repo/factory-core/machine-local';

const MAX_DETAIL_CHARS = 500;

/**
 * The detail a workspace failure reports to the server. Git and shell output name Cell paths, and the
 * server refuses free text with a machine-local value, so such output is replaced by a summary. The full
 * output is always in the failure's log blob.
 */
export const workspaceDetailOf = (stage: string, detail: string): string => {
  if (!isMachineIndependentText(detail)) {
    return `${stage} failed on this Cell; the log holds the full output`;
  }
  return detail.slice(0, MAX_DETAIL_CHARS);
};
