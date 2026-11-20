export type HttpStatus = 200 | 400 | 404 | 413 | 500;

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

export const isBaseError = (error: unknown): error is BaseError =>
  error instanceof BaseError;
