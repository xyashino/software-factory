export class FactoryUnavailable extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(status: number, code?: string, detail?: string) {
    super(`factory-server unavailable (status ${status})`);
    this.name = 'FactoryUnavailable';
    this.status = status;
    if (code !== undefined) this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
