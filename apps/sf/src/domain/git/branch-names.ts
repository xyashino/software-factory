const FACTORY_PREFIX = 'factory/';
const PLAN_PREFIX = 'feat/';
const REMOTE_PREFIX = 'origin/';

export const factoryBranchOf = (slug: string): string =>
  `${FACTORY_PREFIX}${slug}`;

export const planBranchOf = (planSlug: string): string =>
  `${PLAN_PREFIX}${planSlug}`;

export const baseRefOf = (baseBranch: string, hasLocalRef: boolean): string =>
  hasLocalRef ? baseBranch : `${REMOTE_PREFIX}${baseBranch}`;

export const slugOf = (orderId: string | null): string =>
  (orderId ?? '').split(':').pop() ?? '';
