import type { APIRoute } from 'astro';
import { errorReply } from '@/server/http-reply';
import { resolveSessionAuth } from '@/server/session';

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'private, no-store, no-transform',
  connection: 'keep-alive',
};

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const { baseUrl, token, projectId } = await resolveSessionAuth(process.env);
    const upstream = new URL('/api/v1/stream', baseUrl);
    upstream.searchParams.set('projectId', projectId);
    const afterSeq = url.searchParams.get('afterSeq');
    if (afterSeq !== null && /^\d+$/.test(afterSeq)) {
      upstream.searchParams.set('afterSeq', afterSeq);
    }

    const response = await fetch(upstream, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      },
      signal: request.signal,
    });

    if (!response.ok || response.body === null) {
      return new Response('Upstream stream unavailable', { status: 502 });
    }

    return new Response(response.body, {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    return errorReply(error);
  }
};
