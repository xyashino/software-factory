export class Refused extends Error {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

export class Unauthorized extends Refused {}

export class ArgumentError extends Error {}

export class Unreachable extends Error {}
