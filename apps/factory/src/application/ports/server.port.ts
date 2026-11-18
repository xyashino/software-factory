import type { Access } from '../../domain/access';

export interface ServerPort {
  call(route: string, body: unknown, token: Access): Promise<unknown>;
  stream(
    route: string,
    query: Record<string, string>,
    token: Access,
  ): AsyncIterable<unknown>;
}
