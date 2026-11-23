import { z } from 'zod';
import {
  TargetNameSchema,
  withoutTarget,
  type ConnectionConfig,
  type ConnectionTarget,
} from '../../../domain/connection/connection-config';
import { ArgumentError } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const EmptySchema = z.object({}).strict();

const NameSchema = z.object({ name: TargetNameSchema }).strict();

export interface TargetRow {
  name: string;
  url: string;
  active: boolean;
}

export interface TargetListResult {
  targets: TargetRow[];
}

const requireTarget = (
  ctx: Ports,
  name: string,
): { config: ConnectionConfig; target: ConnectionTarget } => {
  const config = ctx.connections.read();
  const target = config.targets[name];
  if (target === undefined) {
    throw new ArgumentError(`no target named ${name}`);
  }
  return { config, target };
};

export const listTargets = define({ kind: 'operator' })(
  EmptySchema,
)<TargetListResult>(async (_input, ctx) => {
  const { current, targets } = ctx.connections.read();
  return {
    targets: Object.entries(targets).map(([name, target]) => ({
      name,
      url: target.url,
      active: name === current,
    })),
  };
});

export const useTarget = define({ kind: 'operator' })(NameSchema)<TargetRow>(
  async (input, ctx) => {
    const { config, target } = requireTarget(ctx, input.name);
    ctx.connections.write({ ...config, current: input.name });
    return { name: input.name, url: target.url, active: true };
  },
);

export const removeTarget = define({ kind: 'operator' })(NameSchema)<{
  name: string;
}>(async (input, ctx) => {
  const { config } = requireTarget(ctx, input.name);
  ctx.connections.write(withoutTarget(config, input.name));
  return { name: input.name };
});
