export class FactoryUnavailable extends Error {
  readonly status: number;
  readonly errorType?: string;

  constructor(status: number, errorType?: string, message?: string) {
    super(message ?? `HQ request failed (status ${String(status)})`);
    this.name = 'FactoryUnavailable';
    this.status = status;
    this.errorType = errorType;
  }
}
