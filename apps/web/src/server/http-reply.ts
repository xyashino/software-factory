import { FactoryUnavailable } from './factory-error';

const NO_STORE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'private, no-store',
};

const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;

export const jsonReply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: NO_STORE_HEADERS,
  });

export const errorReply = (error: unknown): Response => {
  if (error instanceof FactoryUnavailable) {
    const status = error.status > 0 ? error.status : HTTP_BAD_GATEWAY;
    return jsonReply(
      {
        code: status,
        type: error.errorType ?? 'FactoryUnavailable',
        message: error.message,
      },
      status,
    );
  }
  return jsonReply(
    {
      code: HTTP_INTERNAL_ERROR,
      type: 'InternalError',
      message: 'Unexpected server error',
    },
    HTTP_INTERNAL_ERROR,
  );
};
