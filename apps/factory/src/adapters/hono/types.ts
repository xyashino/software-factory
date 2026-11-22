import type { TransportContext } from '../../application/core/procedure';
import type { CellId } from '../../domain/common/brand';

export type TransportRequest = {
  bearer: string | null;
  cellId: CellId | null;
  signal: AbortSignal;
  remoteAddress: string | null;
};

export type CreateTransport = (request: TransportRequest) => TransportContext;

export type AppEnv = {
  Bindings: { remoteAddress?: string | null };
  Variables: {
    requestId: string;
    transport: TransportContext;
  };
};
