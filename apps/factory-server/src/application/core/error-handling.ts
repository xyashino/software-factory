export type HttpStatus =
  200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;

export class BaseError extends Error {
  readonly status: HttpStatus;
  readonly type: string;

  constructor(status: HttpStatus, type: string, message: string) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

export class BadRequest extends BaseError {
  constructor(message: string) {
    super(400, 'bad-request', message);
  }
}

export class Unauthorized extends BaseError {
  constructor(message: string) {
    super(401, 'unauthorized', message);
  }
}

export class Forbidden extends BaseError {
  constructor(message: string) {
    super(403, 'forbidden', message);
  }
}

export class NotFound extends BaseError {
  constructor(message: string) {
    super(404, 'not-found', message);
  }
}

export class Conflict extends BaseError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class StaleLeaseEpoch extends BaseError {
  constructor(message: string) {
    super(409, 'stale-lease-epoch', message);
  }
}

export class PayloadTooLarge extends BaseError {
  constructor(message: string) {
    super(413, 'payload-too-large', message);
  }
}

export class UnprocessableEntity extends BaseError {
  constructor(message: string) {
    super(422, 'unprocessable-entity', message);
  }
}

export class InternalServer extends BaseError {
  constructor(message: string) {
    super(500, 'internal-server-error', message);
  }
}

export const isBaseError = (error: unknown): error is BaseError =>
  error instanceof BaseError;
