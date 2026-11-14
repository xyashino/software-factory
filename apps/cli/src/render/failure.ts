import type { WireError } from '@repo/factory-core/contracts/errors';

/** One line for a refusal the Supervisor reads on stderr (PROTOCOL §3.5). */
export const describeFailure = (error: WireError): string => {
  switch (error.code) {
    case 'not_found':
      return 'not found: no such work order, Cell or token';
    case 'stale_epoch':
      return `stale epoch: the job was taken over (current epoch ${error.current})`;
    case 'not_live':
      return `the Cycle ${error.cycleId} already ended`;
    case 'precondition':
      return `refused: ${error.detail}`;
    case 'invalid':
      return `invalid: ${error.issues.join('; ')}`;
    case 'unavailable':
      return 'factory unavailable: the request could not be completed; try again (no server answered, or it failed; see its log)';
    case 'unauthorized':
      return 'unauthorized: the Cell is unknown or revoked';
  }
};
