import { HTTP_ROUTES, httpPath, type HttpRoute } from './http-routes';
import { wireErrorSchema, WireFailure } from './errors';
import type { RouteName, RouteRequest, RouteResponse } from './routes';

/**
 * The HTTP form of one route call (PROTOCOL §3), and the reading of its answer. Pure: no fetch and
 * no I/O, so the CLI and a Cell send the same bytes through their own transport. The route table
 * decides the method and the path; the shared schemas decide the payload.
 */

/** One HTTP request: its method and path, and either a JSON body or the raw bytes of a blob. */
export interface HttpCall {
  readonly method: HttpRoute['method'];
  readonly path: string;
  readonly json?: string;
  readonly raw?: Uint8Array;
  readonly mediaType?: string;
}

const specOf = (route: RouteName): HttpRoute => {
  if (!(route in HTTP_ROUTES)) {
    throw new Error(`${route} has no HTTP route (PROTOCOL §3)`);
  }
  return HTTP_ROUTES[route as keyof typeof HTTP_ROUTES];
};

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const base64Of = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * Encodes a route call. Path parameters come out of the request (`:id` from `orderId`); the rest
 * of the request is the JSON body. A blob upload sends its bytes raw, with the media type as the
 * content type; its `ref` is in the path.
 */
export const encodeHttpCall = <K extends RouteName>(
  route: K,
  request: RouteRequest<K>,
): HttpCall => {
  const spec = specOf(route);
  const input: Record<string, unknown> = { ...(request as object) };
  const values: Record<string, string> = {};
  for (const [param, field] of Object.entries(spec.params ?? {})) {
    const value = input[field];
    if (typeof value !== 'string') {
      throw new Error(`${route}: ${field} must be a string for the path`);
    }
    values[param] = value;
    delete input[field];
  }
  const path = httpPath(route as keyof typeof HTTP_ROUTES, values);

  if (route === 'blobPut') {
    const { base64, mediaType } = input as {
      base64: string;
      mediaType?: string;
    };
    return {
      method: 'PUT',
      path,
      raw: bytesOf(base64),
      ...(mediaType !== undefined ? { mediaType } : {}),
    };
  }
  if (spec.method === 'POST') {
    return { method: 'POST', path, json: JSON.stringify(input) };
  }
  return { method: spec.method, path };
};

/**
 * The failure an error answer stands for: its wire error when the body carries one (PROTOCOL §3.5),
 * else the code its status means. A proxy or a crash answers without a wire body.
 */
export const refusalOf = (status: number, bytes: Uint8Array): WireFailure => {
  try {
    const parsed = wireErrorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (parsed.success) return new WireFailure(parsed.data, status);
  } catch {
    // not JSON: the status says what happened
  }
  return new WireFailure(
    { code: status === 401 ? 'unauthorized' : 'unavailable' },
    status,
  );
};

/**
 * Reads the answer of a route call. An error status becomes a `WireFailure` with the shared wire
 * error (PROTOCOL §3.5); `204` is an empty claim; a blob answers its raw bytes, returned as the
 * route's base64 response. Anything else is the route's JSON response, parsed by its schema.
 */
export const decodeHttpAnswer = <K extends RouteName>(
  route: K,
  request: RouteRequest<K>,
  status: number,
  bytes: Uint8Array,
): RouteResponse<K> => {
  if (status === 204) {
    if (route === 'claim') return { job: null } as RouteResponse<K>;
    throw new WireFailure({ code: 'unavailable' }, status);
  }
  if (status >= 400) throw refusalOf(status, bytes);
  const text = new TextDecoder().decode(bytes);
  if (route === 'blobGet') {
    return {
      ref: (request as { ref: string }).ref,
      base64: base64Of(bytes),
    } as RouteResponse<K>;
  }
  return JSON.parse(text) as RouteResponse<K>;
};
