const FACTORY_PREFIX = 'factory/';
const PLAN_PREFIX = 'feat/';

export const factoryBranchOf = (slug: string): string =>
  `${FACTORY_PREFIX}${slug}`;

export const planBranchOf = (planSlug: string): string =>
  `${PLAN_PREFIX}${planSlug}`;

export const slugOf = (orderId: string | null): string =>
  (orderId ?? '').split(':').pop() ?? '';
