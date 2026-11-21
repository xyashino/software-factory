import type { Ports } from '../../core/procedure';

export const isAnswering = (ctx: Ports): Promise<boolean> =>
  ctx.cellServer.health().then(
    () => true,
    () => false,
  );
