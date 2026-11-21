export interface CellServerPort {
  health(): Promise<unknown>;
  get(route: string): Promise<unknown>;
  post(route: string, body?: unknown): Promise<unknown>;
  patch(route: string, body: unknown): Promise<unknown>;
  delete(route: string): Promise<unknown>;
}
