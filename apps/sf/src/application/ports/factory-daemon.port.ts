export interface FactoryDaemonPort {
  get(route: string): Promise<unknown>;
  post(route: string, body: unknown): Promise<unknown>;
  delete(route: string): Promise<unknown>;
}
