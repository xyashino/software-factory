export type HttpStatus = 200 | 201 | 400 | 404 | 409 | 413 | 500 | 502;

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

export class PayloadTooLarge extends BaseError {
  constructor(message: string) {
    super(413, 'payload-too-large', message);
  }
}

export class InternalServer extends BaseError {
  constructor(message: string) {
    super(500, 'internal-server-error', message);
  }
}

export class BadGateway extends BaseError {
  constructor(message: string) {
    super(502, 'bad-gateway', message);
  }
}

export const isBaseError = (error: unknown): error is BaseError =>
  error instanceof BaseError;

export const asBadRequest = <T>(validate: () => T): T => {
  try {
    return validate();
  } catch (error) {
    if (error instanceof RangeError) throw new BadRequest(error.message);
    throw error;
  }
};
