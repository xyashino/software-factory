import type { JobId } from '../../domain/common/brand';

export interface OperatorEndpoint {
  url: string;
}

export interface OperatorEndpointPort {
  open(
    jobId: JobId,
    handler: (request: unknown) => Promise<unknown>,
  ): Promise<OperatorEndpoint>;
  close(): Promise<void>;
}
