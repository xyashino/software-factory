export interface FactoryDaemonPort {
  get(route: string): Promise<unknown>;
  post(route: string, body: unknown): Promise<unknown>;
  put(route: string, body: unknown): Promise<unknown>;
}
