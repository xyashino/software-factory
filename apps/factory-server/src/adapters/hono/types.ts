import type { TransportContext } from '../../application/core/procedure';

export type TransportRequest = {
  bearer: string | null;
  signal: AbortSignal;
};

export type CreateTransport = (request: TransportRequest) => TransportContext;

export type AppEnv = {
  Variables: {
    requestId: string;
    transport: TransportContext;
  };
};
