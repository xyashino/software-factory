import { z } from 'zod';
import { normalizeUrl } from '../../../domain/connection/connection-config';
import { Refused, Unreachable } from '../../core/errors';
import { define } from '../../core/procedure';

const ConnectSchema = z
  .object({
    url: z.url(),
    token: z.string().trim().min(1),
    name: z.string().min(1),
  })
  .strict();

export interface ConnectFactoryResult {
  factoryId: string;
  expiresAt: number;
}

export const connectFactory = define({ kind: 'supervisor' })(
  ConnectSchema,
)<ConnectFactoryResult>(async (input, ctx) => {
  const url = normalizeUrl(input.url);
  const reply = await ctx.hqLink.enroll({
    url,
    joinToken: input.token,
    name: input.name,
  });
  if (reply.kind === 'rejected') {
    throw new Refused(
      'join token rejected: it was used or never issued, mint a new one with sf token create --kind factory_join',
    );
  }
  if (reply.kind === 'unreachable') {
    throw new Unreachable(`HQ did not answer at ${url}`);
  }
  const { factoryId, sessionToken, expiresAt } = reply.value;
  ctx.factoryCredential.write({ url, factoryId, sessionToken });
  return { factoryId, expiresAt };
});
