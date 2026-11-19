import { FactoryUnavailable } from './factory-error';

const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const PLAIN_TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' };

export const textResponse = (status: number, body: string): Response =>
  new Response(body, { status, headers: PLAIN_TEXT_HEADERS });

export const failureResponse = (error: unknown): Response => {
  if (!(error instanceof FactoryUnavailable)) throw error;
  if (error.status === HTTP_NOT_FOUND) {
    return textResponse(HTTP_NOT_FOUND, 'not found');
  }
  return textResponse(HTTP_UNAVAILABLE, 'factory-server unreachable');
};
