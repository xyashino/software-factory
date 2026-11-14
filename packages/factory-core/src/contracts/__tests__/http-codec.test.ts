import { describe, expect, it } from 'vitest';
import type { CellId, JobId, OrderId } from '../../ids';
import { WireFailure } from '../errors';
import { decodeHttpAnswer, encodeHttpCall } from '../http-codec';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;

describe('encodeHttpCall', () => {
  it('moves a path field out of the body into the path', () => {
    const call = encodeHttpCall('answer', {
      orderId: ORDER,
      commandId: 'cmd-1',
      questionId: 'q-1',
      text: 'yes',
    });

    expect(call.method).toBe('POST');
    expect(call.path).toBe('/v1/orders/software-factory%3Atodo-1/answer');
    expect(JSON.parse(call.json ?? '{}')).toEqual({
      commandId: 'cmd-1',
      questionId: 'q-1',
      text: 'yes',
    });
  });

  it('sends a job command to the job path, without the job id in the body', () => {
    const call = encodeHttpCall('submitCommand', {
      cellId: CELL,
      orderId: ORDER,
      commandId: `${JOB}:start`,
      epoch: 1,
      command: { type: 'StartCycle', baseCommit: 'b'.repeat(40) as never },
      jobId: JOB,
    } as never);

    expect(call.path).toBe(`/v1/cell/jobs/${JOB}/commands`);
    expect(JSON.parse(call.json ?? '{}')).not.toHaveProperty('jobId');
  });

  it('sends a blob upload as raw bytes with its media type', () => {
    const call = encodeHttpCall('blobPut', {
      ref: 'sha256:abc' as never,
      base64: Buffer.from('hello').toString('base64'),
      mediaType: 'text/plain',
    });

    expect(call.method).toBe('PUT');
    expect(call.path).toBe('/v1/blobs/sha256%3Aabc');
    expect(new TextDecoder().decode(call.raw)).toBe('hello');
    expect(call.mediaType).toBe('text/plain');
  });

  it('sends a read with no body', () => {
    const call = encodeHttpCall('board', {});

    expect(call).toEqual({ method: 'GET', path: '/v1/board' });
  });

  it('refuses a route with no HTTP route', () => {
    expect(() =>
      encodeHttpCall('supervisorEvents', {
        afterGlobalSeq: 0,
      }),
    ).toThrow(/has no HTTP route/);
  });
});

describe('decodeHttpAnswer', () => {
  const bytesOf = (text: string) => new TextEncoder().encode(text);

  it('reads an empty claim as no job', () => {
    expect(
      decodeHttpAnswer(
        'claim',
        { cellId: CELL, waitMs: 0 },
        204,
        new Uint8Array(),
      ),
    ).toEqual({ job: null });
  });

  it('reads a JSON answer as the route response', () => {
    expect(
      decodeHttpAnswer('board', {}, 200, bytesOf('{"orders":[]}')),
    ).toEqual({ orders: [] });
  });

  it('reads a blob as base64 with the requested ref', () => {
    const answer = decodeHttpAnswer(
      'blobGet',
      { ref: 'sha256:abc' as never },
      200,
      bytesOf('hello'),
    );

    expect(answer).toEqual({
      ref: 'sha256:abc',
      base64: Buffer.from('hello').toString('base64'),
    });
  });

  it('turns a refusal into the shared wire failure with its status', () => {
    try {
      decodeHttpAnswer(
        'board',
        {},
        409,
        bytesOf('{"code":"stale_epoch","current":3}'),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(WireFailure);
      expect((error as WireFailure).error).toEqual({
        code: 'stale_epoch',
        current: 3,
      });
      expect((error as WireFailure).status).toBe(409);
    }
  });

  it('reads a 401 with no wire body as unauthorized', () => {
    try {
      decodeHttpAnswer('board', {}, 401, bytesOf('<html>denied</html>'));
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as WireFailure).error).toEqual({ code: 'unauthorized' });
    }
  });
});
