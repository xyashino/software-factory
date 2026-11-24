import type { APIRoute } from 'astro';
import { z } from 'zod';
import { errorReply, jsonReply } from '@/server/http-reply';
import { createSessionClient } from '@/server/session';
import { isAllowedWebAction, isSameOrigin } from '@/server/write-guard';

const bodySchema = z.object({ action: z.string().min(1) });

export const POST: APIRoute = async ({ params, request }) => {
  if (
    !isSameOrigin(
      request.headers.get('origin'),
      request.url,
      request.headers.get('host'),
    )
  ) {
    return jsonReply(
      { code: 403, type: 'Forbidden', message: 'Origin mismatch' },
      403,
    );
  }

  const id = params.id;
  if (!id) {
    return jsonReply(
      { code: 400, type: 'BadRequest', message: 'Missing work order id' },
      400,
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isAllowedWebAction(parsed.data.action)) {
    return jsonReply(
      {
        code: 400,
        type: 'BadRequest',
        message: 'Unsupported transition action',
      },
      400,
    );
  }

  try {
    const { client } = await createSessionClient(process.env);
    const data = await client.transitionWorkOrder(id, parsed.data.action);
    return jsonReply(data, 200);
  } catch (error) {
    return errorReply(error);
  }
};
