import { describe, expect, it } from 'vitest';
import { createRemoteAccess, hashToken, sameHash } from '../remote';
import type { RuntimePorts } from '../ports';

describe('the constant-time hash check', () => {
  it('matches the stored hash of the same token only', () => {
    const stored = hashToken('secret-one');

    expect(sameHash(stored, hashToken('secret-one'))).toBe(true);
    expect(sameHash(stored, hashToken('secret-two'))).toBe(false);
    expect(sameHash(stored, stored.slice(1))).toBe(false);
  });

  it('refuses a Cell whose stored hash is not the presented one', async () => {
    const ports = {
      cells: {
        findByCredentialHash: async () => ({
          credentialHash: hashToken('some-other-credential'),
          record: { cellId: 'C', revokedAt: null },
        }),
      },
    } as unknown as RuntimePorts;

    expect(await createRemoteAccess(ports).cellOf('cell-credential')).toBe(
      undefined,
    );
  });

  it('accepts a Cell whose stored hash is the presented one', async () => {
    const credential = 'cell-credential';
    const ports = {
      cells: {
        findByCredentialHash: async () => ({
          credentialHash: hashToken(credential),
          record: { cellId: 'C', revokedAt: null },
        }),
      },
    } as unknown as RuntimePorts;

    expect(await createRemoteAccess(ports).cellOf(credential)).toBe('C');
  });
});
