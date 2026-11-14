import { describe, expect, it } from 'vitest';
import {
  HTTP_ROUTES,
  HTTP_UNMAPPED,
  httpPath,
  type HttpRouteName,
} from '../http-routes';
import { ROUTES } from '../routes';

describe('HTTP route table', () => {
  it('maps every socket route or lists it as unmapped with a reason', () => {
    const mapped = Object.keys(HTTP_ROUTES).filter((name) => name in ROUTES);
    const unmapped = Object.keys(HTTP_UNMAPPED);
    const covered = [...mapped, ...unmapped].sort();

    expect(covered).toEqual(Object.keys(ROUTES).sort());
    expect(mapped.filter((name) => unmapped.includes(name))).toEqual([]);
  });

  it('gives every route a method and path that no other route shares', () => {
    const keys = Object.values(HTTP_ROUTES).map(
      (route) => `${route.method} ${route.path}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('serves the PROTOCOL §3 paths, not the socket paths', () => {
    expect(HTTP_ROUTES.board.path).toBe('/v1/board');
    expect(HTTP_ROUTES.answer.path).toBe('/v1/orders/:id/answer');
    expect(HTTP_ROUTES.submitCommand.path).toBe(
      '/v1/cell/jobs/:jobId/commands',
    );
    expect(HTTP_ROUTES.blobGet.path).toBe('/v1/blobs/:ref');
    expect(HTTP_ROUTES.join.path).toBe('/v1/cell/join');
    expect(HTTP_ROUTES.stream.path).toBe('/v1/stream');
  });

  it('reads and writes supervisor-only and Cell-only routes as declared', () => {
    expect(HTTP_ROUTES.board.auth).toBe('supervisor');
    expect(HTTP_ROUTES.claim.auth).toBe('cell');
    expect(HTTP_ROUTES.join.auth).toBe('join');
    expect(HTTP_ROUTES.blobGet.auth).toBe('supervisor_or_cell');
    expect(HTTP_ROUTES.blobPut.auth).toBe('cell');
  });

  it('has no HTTP route that creates a supervisor token', () => {
    const names: string[] = Object.keys(HTTP_ROUTES);

    expect(names.filter((name) => /supervisor.*token/i.test(name))).toEqual([]);
    expect(
      Object.values(HTTP_ROUTES).filter((route) =>
        /supervisor.*token/i.test(route.path),
      ),
    ).toEqual([]);
  });
});

describe('httpPath', () => {
  it('fills a parameter and encodes it as one segment', () => {
    expect(httpPath('orderDetail', { id: 'software-factory:todo 1/x' })).toBe(
      '/v1/orders/software-factory%3Atodo%201%2Fx',
    );
  });

  it('keeps a blob ref readable as one segment', () => {
    expect(httpPath('blobGet', { ref: 'sha256:abc' })).toBe(
      '/v1/blobs/sha256%3Aabc',
    );
  });

  it('returns the path of a route with no parameters', () => {
    expect(httpPath('board')).toBe('/v1/board');
  });

  it('refuses a missing parameter', () => {
    expect(() => httpPath('orderDetail' satisfies HttpRouteName)).toThrow(
      /missing path parameter id/,
    );
  });
});
