import { enrollCellContract } from '../../../contracts/cells.contract';
import type { Ports } from '../../core/procedure';
import type { CellSession } from '../../ports/cell-state.port';

const ENROLL_ROUTE = '/api/v1/cells/enroll';

export interface EnrollInput {
  projectId: string;
  name: string;
  allowedLines: string[];
  runners: string[];
  joinToken: string;
}

export const enrollCell = async (
  ports: Ports,
  input: EnrollInput,
): Promise<CellSession> => {
  const reply = enrollCellContract.out[201].parse(
    await ports.server.call(
      ENROLL_ROUTE,
      {
        projectId: input.projectId,
        name: input.name,
        allowedLines: input.allowedLines,
        runners: input.runners,
      },
      input.joinToken,
    ),
  );
  const session = { cellId: reply.cellId, sessionToken: reply.sessionToken };
  await ports.cellState.write(session);
  return session;
};
