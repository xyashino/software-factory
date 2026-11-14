import { describe, expect, it } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, CommitSha, JobId, OrderId } from '@repo/factory-core/ids';
import { remoteFactoryClient } from '../remote-client';
import { submit, type JobContext } from '../jobs/send';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const ORDER = 'software-factory:todo-1' as OrderId;
const COMMIT = 'a'.repeat(40) as CommitSha;

/**
 * A Cell in remote mode submits a command for its job. The remote route carries the job in its path
 * (PROTOCOL §3.2), so the submit must name the job; without it the codec refuses before any request.
 * The fake Factory answers 400, so the call ends in the wire refusal the Factory would send.
 */
describe('a Cell command over the remote route', () => {
  it('sends the command to the job path and is refused by the Factory, not by the codec', async () => {
    const urls: string[] = [];
    const refuse = (url: string): Promise<Response> => {
      urls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'invalid', issues: [] }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const client = remoteFactoryClient({
      baseUrl: 'http://factory.test',
      credential: 'credential',
      attempts: 1,
      sleep: () => Promise.resolve(),
      fetchImpl: refuse as typeof fetch,
    });
    const ctx = { client, cellId: CELL } as unknown as JobContext;
    const job = {
      jobId: JOB,
      orderId: ORDER,
      epoch: 1,
    } as unknown as Job;

    const outcome = await submit(
      ctx,
      job,
      { type: 'StartCycle', baseCommit: COMMIT },
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(WireFailure);
    expect(urls).toEqual([`http://factory.test/v1/cell/jobs/${JOB}/commands`]);
  });
});
