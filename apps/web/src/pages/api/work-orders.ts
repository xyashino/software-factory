import { WORK_ORDER_STATES } from '@repo/hq-contracts/enums/orders';
import type { APIRoute } from 'astro';
import { errorReply, jsonReply } from '@/server/http-reply';
import { createSessionClient } from '@/server/session';

const isWorkOrderState = (value: string): boolean =>
  (WORK_ORDER_STATES as readonly string[]).includes(value);

export const GET: APIRoute = async ({ url }) => {
  const rawState = url.searchParams.get('state') ?? undefined;
  if (rawState !== undefined && !isWorkOrderState(rawState)) {
    return jsonReply(
      { code: 400, type: 'BadRequest', message: `Invalid state: ${rawState}` },
      400,
    );
  }

  try {
    const { client, projectId } = await createSessionClient(process.env);
    const data = await client.listWorkOrders({ projectId, state: rawState });
    return jsonReply(data, 200);
  } catch (error) {
    return errorReply(error);
  }
};
