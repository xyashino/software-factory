import { describe, expect, it } from 'vitest';
import { createJoinToken, revokeJoinToken } from '../join-tokens';
import { revokeCell } from '../cells';
import { hashToken } from '../remote';
import { world } from './test-kit';

const COMMAND = 'cmd-join-token-1';

describe('remote credentials', () => {
  it('enrolls a Cell with a live join token and authenticates its credential', async () => {
    const w = world();
    const token = await createJoinToken(w.ports, {
      commandId: COMMAND,
      name: 'pool',
    });

    const joined = await w.runtime.remote.joinCell({
      joinToken: token.token,
      name: 'cell-a',
    });

    expect(await w.runtime.remote.cellOf(joined.credential)).toBe(
      joined.cellId,
    );
  });

  it('refuses a join with an unknown join token as unauthorized', async () => {
    const w = world();

    const refused = w.runtime.remote.joinCell({
      joinToken: 'not-a-real-join-token-value',
      name: 'cell-a',
    });

    await expect(refused).rejects.toMatchObject({
      wire: { code: 'unauthorized' },
    });
  });

  it('refuses a revoked join token and an expired one', async () => {
    const w = world();
    const revoked = await createJoinToken(w.ports, {
      commandId: 'cmd-revoked',
      name: 'revoked',
    });
    await revokeJoinToken(w.ports, revoked.joinTokenId);
    const expired = await createJoinToken(w.ports, {
      commandId: 'cmd-expired',
      name: 'expired',
      ttlSeconds: 60,
    });
    w.clock.advance(61_000);

    await expect(
      w.runtime.remote.joinCell({ joinToken: revoked.token, name: 'a' }),
    ).rejects.toMatchObject({ wire: { code: 'unauthorized' } });
    await expect(
      w.runtime.remote.joinCell({ joinToken: expired.token, name: 'b' }),
    ).rejects.toMatchObject({ wire: { code: 'unauthorized' } });
  });

  it('refuses the credential of a revoked Cell', async () => {
    const w = world();
    const token = await createJoinToken(w.ports, {
      commandId: COMMAND,
      name: 'pool',
    });
    const joined = await w.runtime.remote.joinCell({
      joinToken: token.token,
      name: 'cell-a',
    });
    await revokeCell(w.ports, joined.cellId);

    expect(await w.runtime.remote.cellOf(joined.credential)).toBeUndefined();
  });

  it('refuses an unknown credential', async () => {
    const w = world();

    expect(
      await w.runtime.remote.cellOf('a-credential-nobody-was-given'),
    ).toBeUndefined();
  });
});

describe('supervisor tokens', () => {
  it('creates a token that authenticates by name and is stored as a hash only', async () => {
    const w = world();

    const created = await w.runtime.remote.createSupervisorToken('dev');

    expect(await w.runtime.remote.supervisorName(created.token)).toBe('dev');
    expect(w.supervisorTokens.all()).toEqual([
      { tokenHash: hashToken(created.token), name: 'dev' },
    ]);
  });

  it('does not authenticate an unknown token', async () => {
    const w = world();

    expect(await w.runtime.remote.supervisorName('guessed-token')).toBe(
      undefined,
    );
  });

  it('refuses to create a token without the writer lock', async () => {
    const w = world();
    w.writer.held = false;

    await expect(
      w.runtime.remote.createSupervisorToken('dev'),
    ).rejects.toThrow();
  });
});

describe('job ownership', () => {
  it('refuses a job the Cell does not hold as not_found', async () => {
    const w = world();
    const token = await createJoinToken(w.ports, {
      commandId: COMMAND,
      name: 'pool',
    });
    const joined = await w.runtime.remote.joinCell({
      joinToken: token.token,
      name: 'cell-a',
    });

    await expect(
      w.runtime.remote.orderOfJob(
        joined.cellId,
        '01J0000000000000000000000J' as never,
      ),
    ).rejects.toMatchObject({ wire: { code: 'not_found' } });
  });
});
