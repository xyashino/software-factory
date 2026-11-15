import { z } from 'zod';

const HealthSchema = z.object({ ok: z.literal(true) });

export const prerender = false;

export const GET = (): Response => {
  const body = HealthSchema.parse({ ok: true });
  return Response.json(body);
};
