import type { APIRoute } from 'astro';
import { failureResponse, textResponse } from '../../../../lib/page-error';
import { createSessionClient } from '../../../../lib/session';
import { FactoryUnavailable } from '../../../../lib/factory-error';
import {
  isAllowedAction,
  isSameOrigin,
  type WriteAction,
} from '../../../../lib/write-guard';

const HTTP_SEE_OTHER = 303;
const HTTP_CONFLICT = 409;
const NOTICES: Record<WriteAction, string> = {
  resume: 'Work order resumed',
  cancel: 'Work order cancelled',
};

const redirectTo = (location: string): Response =>
  new Response(null, { status: HTTP_SEE_OTHER, headers: { location } });

const orderPath = (id: string): string =>
  `/work-orders/${encodeURIComponent(id)}`;

export const POST: APIRoute = async ({ params, request }) => {
  const { headers, url } = request;
  if (!isSameOrigin(headers.get('origin'), url, headers.get('host'))) {
    return textResponse(403, 'forbidden');
  }
  const action = params.action ?? '';
  if (!isAllowedAction(action)) return textResponse(400, 'unsupported action');
  const form = await request.formData().catch(() => new FormData());
  if (action === 'cancel' && form.get('confirm') !== 'yes') {
    return textResponse(400, 'confirm the delete');
  }

  const id = decodeURIComponent(params.id ?? '');
  const session = await createSessionClient(process.env).catch(failureResponse);
  if (session instanceof Response) return session;

  try {
    await session.client.transitionWorkOrder(id, action);
  } catch (error) {
    if (error instanceof FactoryUnavailable && error.status === HTTP_CONFLICT) {
      const code = error.code ?? 'conflict';
      const message = error.detail ?? 'request conflicts with current state';
      return redirectTo(
        `${orderPath(id)}?error=${encodeURIComponent(`${code}: ${message}`)}`,
      );
    }
    return failureResponse(error);
  }
  return redirectTo(
    `${orderPath(id)}?notice=${encodeURIComponent(NOTICES[action])}`,
  );
};
