export interface FactoryPort {
  get(route: string): Promise<unknown>;
  post(route: string, body: unknown): Promise<unknown>;
  put(route: string, body: unknown): Promise<unknown>;
}
