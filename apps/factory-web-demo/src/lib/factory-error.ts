export class FactoryUnavailable extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`factory-server unavailable (status ${status})`);
    this.name = 'FactoryUnavailable';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}
