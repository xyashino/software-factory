import { z } from 'zod';
import {
  listFactoriesContract,
  removeFactoryContract,
  setDefaultFactoryContract,
  upsertFactoryContract,
} from '@repo/cell-contracts/factories.contract';
import { Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { checkedReply } from './checked-reply';
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

const FACTORIES_ROUTE = '/api/v1/factories';

const listFactoriesReply = async (ctx: Ports): Promise<Factory[]> =>
  checkedReply(
    FACTORIES_ROUTE,
    listFactoriesContract,
    FactoriesReplySchema,
    await ctx.cellServer.get(FACTORIES_ROUTE),
  ).factories;

const factoryNamed = async (ctx: Ports, name: string): Promise<Factory> => {
  const factories = await listFactoriesReply(ctx);
  const found = factories.find((factory) => factory.name === name);
  if (found === undefined) {
    throw new Refused(`factory not found: ${name}`);
  }
  return found;
};

export const addFactory = define({ kind: 'supervisor' })(AddSchema)<Factory>(
  async (input, ctx) => {
    const body: z.input<typeof upsertFactoryContract.in.body> = {
      name: input.name,
      url: input.url,
      ...(input.joinToken === undefined ? {} : { joinToken: input.joinToken }),
      ...(input.supervisorToken === undefined
        ? {}
        : { supervisorToken: input.supervisorToken }),
      ...(input.isDefault ? { isDefault: true } : {}),
    };
    const reply = await ctx.cellServer.post(FACTORIES_ROUTE, body);
    return checkedReply(
      FACTORIES_ROUTE,
      upsertFactoryContract,
      FactoryReplySchema,
      reply,
    ).factory;
  },
);

export const listFactories = define({ kind: 'supervisor' })(EmptySchema)<
  Factory[]
>((_input, ctx) => listFactoriesReply(ctx));

export const useFactory = define({ kind: 'supervisor' })(
  NameOnlySchema,
)<Factory>(async (input, ctx) => {
  const factory = await factoryNamed(ctx, input.name);
  const route = `${FACTORIES_ROUTE}/${encodeURIComponent(factory.factoryId)}/default`;
  const reply = await ctx.cellServer.post(route);
  return checkedReply(
    route,
    setDefaultFactoryContract,
    FactoryReplySchema,
    reply,
  ).factory;
});

export const removeFactory = define({ kind: 'supervisor' })(
  NameOnlySchema,
)<string>(async (input, ctx) => {
  const factory = await factoryNamed(ctx, input.name);
  const route = `${FACTORIES_ROUTE}/${encodeURIComponent(factory.factoryId)}`;
  const reply = await ctx.cellServer.delete(route);
  checkedReply(
    route,
    removeFactoryContract,
    removeFactoryContract.out[200],
    reply,
  );
  return factory.factoryId;
});
