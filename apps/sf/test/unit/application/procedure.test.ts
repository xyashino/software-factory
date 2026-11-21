import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArgumentError, Refused } from '../../../src/application/core/errors';
import { define } from '../../../src/application/core/procedure';
import type { Ports } from '../../../src/application/core/procedure';
import { buildContext } from '../../../src/bootstrap/context';
import { run } from '../../../src/bootstrap/run';
import type { Access } from '../../../src/domain/access';
import { toCellId, toJobId } from '../../../src/domain/common/brand';
import { EXIT } from '../../../src/domain/exit-codes';

const REFUSAL = 'Token cannot run this procedure';

const CELL = toCellId('cell-1');
const JOB = toJobId('job-1');

const supervisorToken: Access = { kind: 'supervisor' };
const cellToken: Access = { kind: 'cell', cellId: CELL };
const otherCellToken: Access = { kind: 'cell', cellId: toCellId('cell-2') };
const jobToken: Access = {
  kind: 'job',
  jobId: JOB,
  role: 'operator',
  epoch: 1,
};
const otherJobToken: Access = {
  kind: 'job',
  jobId: toJobId('job-2'),
  role: 'operator',
  epoch: 1,
};

const nameSchema = z.object({ name: z.string() }).strict();

const countingHandler = () => {
  const calls = { count: 0 };
  const handler = async (input: { name: string }) => {
    calls.count += 1;
    return input.name;
  };
  return { calls, handler };
};

const contextWith = (token: Access) => ({
  ...buildContext(),
  token,
  principal: token,
});

const buildWithToken = (token: Access) => (): Ports => ({
  ...buildContext(),
  tokens: { ...buildContext().tokens, read: async () => token },
});

describe('procedure access rule', () => {
  it('refuses a cell procedure run with a supervisor token', async () => {
    // Arrange
    const { calls, handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const attempt = procedure.execute(
      { name: 'x' },
      contextWith(supervisorToken),
    );

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Refused);
    await expect(attempt).rejects.toThrow(REFUSAL);
    expect(calls.count).toBe(0);
  });

  it('refuses a cell procedure run with a token for another cell', async () => {
    // Arrange
    const { calls, handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const attempt = procedure.execute(
      { name: 'x' },
      contextWith(otherCellToken),
    );

    // Assert
    await expect(attempt).rejects.toThrow(REFUSAL);
    expect(calls.count).toBe(0);
  });

  it('refuses a job procedure run with a token for another job', async () => {
    // Arrange
    const { calls, handler } = countingHandler();
    const procedure = define({
      kind: 'job',
      jobId: JOB,
      role: 'operator',
      epoch: 1,
    })(nameSchema)(handler);

    // Act
    const attempt = procedure.execute(
      { name: 'x' },
      contextWith(otherJobToken),
    );

    // Assert
    await expect(attempt).rejects.toThrow(REFUSAL);
    expect(calls.count).toBe(0);
  });

  it('runs the handler when the cell token matches the procedure cell', async () => {
    // Arrange
    const { handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const value = await procedure.execute(
      { name: 'x' },
      contextWith(cellToken),
    );

    // Assert
    expect(value).toBe('x');
  });

  it('runs the job procedure for the matching job token', async () => {
    // Arrange
    const { handler } = countingHandler();
    const procedure = define({
      kind: 'job',
      jobId: JOB,
      role: 'operator',
      epoch: 1,
    })(nameSchema)(handler);

    // Act
    const value = await procedure.execute({ name: 'x' }, contextWith(jobToken));

    // Assert
    expect(value).toBe('x');
  });

  it('rejects a bad argument as ArgumentError without running the handler', async () => {
    // Arrange
    const { calls, handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const attempt = procedure.execute({ name: 42 }, contextWith(cellToken));

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
    expect(calls.count).toBe(0);
  });
});

describe('run maps procedure errors to exit codes', () => {
  it('exits 1 when the token cannot run the procedure', async () => {
    // Arrange
    const { handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const result = await run(
      procedure,
      { name: 'x' },
      'cell',
      buildWithToken(supervisorToken),
    );

    // Assert
    expect(result).toEqual({
      kind: 'failed',
      exitCode: EXIT.refused,
      message: REFUSAL,
    });
  });

  it('exits 2 when the argument is invalid', async () => {
    // Arrange
    const { handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const result = await run(
      procedure,
      { name: 42 },
      'cell',
      buildWithToken(cellToken),
    );

    // Assert
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.exitCode).toBe(EXIT.argument);
  });

  it('returns the handler value when the procedure succeeds', async () => {
    // Arrange
    const { handler } = countingHandler();
    const procedure = define({ kind: 'cell', cellId: CELL })(nameSchema)(
      handler,
    );

    // Act
    const result = await run(
      procedure,
      { name: 'x' },
      'cell',
      buildWithToken(cellToken),
    );

    // Assert
    expect(result).toEqual({ kind: 'ok', value: 'x' });
  });
});
