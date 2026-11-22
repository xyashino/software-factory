const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const NO_VALUE = '-';

export const WORK_ORDER_STATE_LIST = [
  'waiting_parent',
  'queued',
  'paused',
  'running',
  'delivering',
  'delivered',
  'completed',
  'line_unavailable',
  'blocked',
  'cancelled',
] as const;

export type WorkOrderState = (typeof WORK_ORDER_STATE_LIST)[number];

const formatRemaining = (remainingMs: number): string => {
  const minutes = Math.floor(remainingMs / MINUTE_MS);
  const seconds = Math.floor((remainingMs % MINUTE_MS) / SECOND_MS);
  return `${minutes}m ${seconds}s`;
};

export const isWorkOrderState = (value: string): value is WorkOrderState =>
  (WORK_ORDER_STATE_LIST as readonly string[]).includes(value);

export const formatTimestamp = (epochMs: number | null): string =>
  epochMs === null ? NO_VALUE : new Date(epochMs).toISOString();

export const countByState = (
  orders: readonly { state: string }[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const order of orders) {
    counts[order.state] = (counts[order.state] ?? 0) + 1;
  }
  return counts;
};

export const formatLease = (
  leaseExpiresAt: number | null,
  now: number,
): string | null => {
  if (leaseExpiresAt === null) return null;
  const remaining = leaseExpiresAt - now;
  const expiry = formatTimestamp(leaseExpiresAt);
  return remaining > 0
    ? `${expiry} (in ${formatRemaining(remaining)})`
    : `${expiry} (expired)`;
};
