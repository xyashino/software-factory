export type Brand<K extends string, T> = T & { readonly __brand: K };

export type ProjectId = Brand<'ProjectId', string>;
export type PlanId = Brand<'PlanId', string>;
export type OrderId = Brand<'OrderId', string>;
export type StepId = Brand<'StepId', string>;
export type JobId = Brand<'JobId', string>;
export type CellId = Brand<'CellId', string>;
export type IncidentId = Brand<'IncidentId', string>;
export type TokenId = Brand<'TokenId', string>;
export type CommandId = Brand<'CommandId', string>;

const requireNonEmpty = <K extends string>(
  kind: K,
  value: string,
): Brand<K, string> => {
  if (value.trim().length === 0)
    throw new RangeError(`${kind} must not be empty`);
  return value as Brand<K, string>;
};

export const asProjectId = (value: string): ProjectId =>
  requireNonEmpty('ProjectId', value);
export const asPlanId = (value: string): PlanId =>
  requireNonEmpty('PlanId', value);
export const asOrderId = (value: string): OrderId =>
  requireNonEmpty('OrderId', value);
export const asStepId = (value: string): StepId =>
  requireNonEmpty('StepId', value);
export const asJobId = (value: string): JobId =>
  requireNonEmpty('JobId', value);
export const asCellId = (value: string): CellId =>
  requireNonEmpty('CellId', value);
export const asIncidentId = (value: string): IncidentId =>
  requireNonEmpty('IncidentId', value);
export const asTokenId = (value: string): TokenId =>
  requireNonEmpty('TokenId', value);
export const asCommandId = (value: string): CommandId =>
  requireNonEmpty('CommandId', value);
