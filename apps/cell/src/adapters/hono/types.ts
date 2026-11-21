import type { TransportContext } from '../../application/core/procedure';

export type TransportRequest = {
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
