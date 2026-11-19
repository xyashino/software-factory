export interface ServerPort {
  call(route: string, body: unknown, token: string): Promise<unknown>;
  stream(
    route: string,
    query: Record<string, string>,
    token: string,
  ): AsyncIterable<unknown>;
  probe(): Promise<boolean>;
}
