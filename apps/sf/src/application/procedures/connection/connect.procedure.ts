import { z } from 'zod';
import {
  defaultTargetNameOf,
  normalizeUrl,
  TargetNameSchema,
  withTarget,
} from '../../../domain/connection/connection-config';
import { Refused, Unauthorized } from '../../core/errors';
import { define } from '../../core/procedure';

const PROJECTS_ROUTE = '/api/v1/projects';

const ConnectSchema = z
  .object({
    url: z.string().url().transform(normalizeUrl),
    name: TargetNameSchema.optional(),
    token: z.string().trim().min(1),
    default: z.boolean(),
  })
  .strict();

export interface ConnectResult {
  name: string;
  url: string;
  active: boolean;
}

export const connectTarget = define({ kind: 'supervisor' })(
  ConnectSchema,
)<ConnectResult>(async (input, ctx) => {
  try {
    await ctx.hq.get(PROJECTS_ROUTE, {}, input.token);
  } catch (error) {
    if (error instanceof Unauthorized) {
      throw new Refused(
        `token rejected by ${input.url}, create a token on that factory and run sf connect again`,
      );
    }
    throw error;
  }
  const name = input.name ?? defaultTargetNameOf(input.url);
  const config = ctx.connections.read();
  const active = input.default || config.current === null;
  ctx.connections.write(
    withTarget(config, name, { url: input.url, token: input.token }, active),
  );
  return { name, url: input.url, active };
});
