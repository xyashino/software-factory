import type { APIRoute } from 'astro';
import { errorReply, jsonReply } from '@/server/http-reply';
import { createSessionClient } from '@/server/session';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return jsonReply(
      { code: 400, type: 'BadRequest', message: 'Missing work order id' },
      400,
    );
  }

  try {
    const { client } = await createSessionClient(process.env);
    const data = await client.getWorkOrder(id);
    return jsonReply(data, 200);
  } catch (error) {
    return errorReply(error);
  }
};
