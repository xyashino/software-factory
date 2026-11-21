export interface SseFrame {
  event: string;
  id: string | null;
  data: string;
}

export interface ServerPort {
  call(route: string, body: unknown, token: string): Promise<unknown>;
  get(
    route: string,
    query: Record<string, string>,
    token: string,
  ): Promise<unknown>;
  remove(route: string, token: string): Promise<unknown>;
  stream(
    route: string,
    query: Record<string, string>,
    token: string,
    signal: AbortSignal,
  ): AsyncIterable<SseFrame>;
  probe(): Promise<boolean>;
}
