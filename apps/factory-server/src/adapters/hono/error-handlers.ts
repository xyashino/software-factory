import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isBaseError } from '../../application/core/error-handling';

export const errorHandler: ErrorHandler = (error, c) => {
  if (isBaseError(error))
    return c.json(
      { code: error.status, type: error.type, message: error.message },
      error.status,
    );
  if (error instanceof HTTPException)
    return c.json(
      { code: error.status, type: 'http-exception', message: error.message },
      error.status,
    );
  return c.json(
    {
      code: 500,
      type: 'internal-server-error',
      message: 'Internal server error',
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    {
      code: 404,
      type: 'not-found',
      message: `Route not found: ${c.req.method} ${c.req.path}`,
    },
    404,
  );
