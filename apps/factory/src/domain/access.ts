import type { CellId, JobId } from './common/brand';

export type Access =
  | { kind: 'supervisor' }
  | { kind: 'cell'; cellId: CellId }
  | {
      kind: 'job';
      jobId: JobId;
      role: 'operator' | 'mechanic';
      epoch: number;
    };
