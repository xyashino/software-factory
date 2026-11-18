import type { JobId } from '../../domain/common/brand';

export interface OperatorEndpointPort {
  open(
    jobId: JobId,
    handler: (request: unknown) => Promise<unknown>,
  ): Promise<void>;
  close(): Promise<void>;
}
