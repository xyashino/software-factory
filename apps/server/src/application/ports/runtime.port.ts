import type { Runtime } from '@repo/factory-runtime/composition';

/** What the application layer reaches of the runtime: the facade its procedures call. */
export type RuntimePort = Pick<
  Runtime,
  'call' | 'remote' | 'feed' | 'recordPullRequest'
>;
