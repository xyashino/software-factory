type Brand<B extends string> = string & { readonly __brand: B };

export type CellId = Brand<'CellId'>;
export type JobId = Brand<'JobId'>;
export type OrderId = Brand<'OrderId'>;
export type IncidentId = Brand<'IncidentId'>;
export type PlanId = Brand<'PlanId'>;
export type ProjectId = Brand<'ProjectId'>;

const requireNonEmpty = (raw: string, kind: string): string => {
  if (raw.length === 0) {
    throw new Error(`${kind} must not be empty`);
  }
  return raw;
};

export const toCellId = (raw: string): CellId =>
  requireNonEmpty(raw, 'CellId') as CellId;
export const toJobId = (raw: string): JobId =>
  requireNonEmpty(raw, 'JobId') as JobId;
export const toOrderId = (raw: string): OrderId =>
  requireNonEmpty(raw, 'OrderId') as OrderId;
export const toIncidentId = (raw: string): IncidentId =>
  requireNonEmpty(raw, 'IncidentId') as IncidentId;
export const toPlanId = (raw: string): PlanId =>
  requireNonEmpty(raw, 'PlanId') as PlanId;
export const toProjectId = (raw: string): ProjectId =>
  requireNonEmpty(raw, 'ProjectId') as ProjectId;
