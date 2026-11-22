import { helloCellContract } from '@repo/factory-contracts/cells.contract';
import type { Ports } from '../../core/procedure';
import type { CellSession } from '../../ports/cell-state.port';

const HELLO_ROUTE = '/api/v1/cells/hello';

export interface HelloInput {
  projectId: string;
  allowedLines: string[];
  runners: string[];
  localWorktrees: { orderId: string; completedStepIds: string[] }[];
}

export const helloCell = async (
  ports: Ports,
  session: CellSession,
  input: HelloInput,
) =>
  helloCellContract.out[200].parse(
    await ports.server.call(HELLO_ROUTE, input, session.sessionToken),
  );
