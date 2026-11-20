import { z } from 'zod';
import { Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import {
  type Factory,
  FactoriesReplySchema,
  FactoryReplySchema,
} from './shapes';

const NameSchema = z.string().min(1);

const AddSchema = z
  .object({
    name: NameSchema,
    url: NameSchema,
    joinToken: NameSchema.optional(),
    supervisorToken: NameSchema.optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();

const NameOnlySchema = z.object({ name: NameSchema }).strict();
const EmptySchema = z.object({}).strict();

const factoryNamed = async (ctx: Ports, name: string): Promise<Factory> => {
  const { factories } = FactoriesReplySchema.parse(
    await ctx.cellServer.get('/api/v1/factories'),
  );
  const found = factories.find((factory) => factory.name === name);
  if (found === undefined) {
    throw new Refused(`factory not found: ${name}`);
  }
  return found;
};

export const addFactory = define({ kind: 'supervisor' })(AddSchema)<Factory>(
  async (input, ctx) => {
    const reply = await ctx.cellServer.post('/api/v1/factories', {
      name: input.name,
      url: input.url,
      ...(input.joinToken === undefined ? {} : { joinToken: input.joinToken }),
      ...(input.supervisorToken === undefined
        ? {}
        : { supervisorToken: input.supervisorToken }),
      ...(input.isDefault ? { isDefault: true } : {}),
    });
    return FactoryReplySchema.parse(reply).factory;
  },
);

export const listFactories = define({ kind: 'supervisor' })(EmptySchema)<
  Factory[]
>(async (_input, ctx) => {
  const reply = await ctx.cellServer.get('/api/v1/factories');
  return FactoriesReplySchema.parse(reply).factories;
});

export const useFactory = define({ kind: 'supervisor' })(
  NameOnlySchema,
)<Factory>(async (input, ctx) => {
  const factory = await factoryNamed(ctx, input.name);
  const reply = await ctx.cellServer.post(
    `/api/v1/factories/${encodeURIComponent(factory.factoryId)}/default`,
  );
  return FactoryReplySchema.parse(reply).factory;
});

export const removeFactory = define({ kind: 'supervisor' })(
  NameOnlySchema,
)<string>(async (input, ctx) => {
  const factory = await factoryNamed(ctx, input.name);
  await ctx.cellServer.delete(
    `/api/v1/factories/${encodeURIComponent(factory.factoryId)}`,
  );
  return factory.factoryId;
});
