import type { APIRoute } from 'astro';
import { jsonReply } from '@/server/http-reply';
import { WEB_VERSION } from '@/version';

export const GET: APIRoute = () =>
  jsonReply({ code: 200, version: WEB_VERSION }, 200);
