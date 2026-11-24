import { afterEach, describe, expect, it } from 'vitest';
import type { FactoryCredential } from '@repo/factory-contracts/status.contract';
import { startFakeHq, type FakeHq } from './support/fake-hq';
import {
  PROJECT_ID,
  bearer,
  callFactory,
  cellEnvOf,
  createHarness,
  readJson,
  scaleTo,
  type Harness,
} from './support/harness';

const CLAIMS_PATH = '/api/v1/cells/claims';
const SESSION_TOKEN = 'session-token-1';
const CLAIM_BODY = {
  projectId: PROJECT_ID,
  allowedLines: ['feature'],
  runners: ['claude'],
};

const fakes: FakeHq[] = [];
const harnesses: Harness[] = [];

const credentialOf = (url: string): FactoryCredential => ({
  url,
  factoryId: 'factory-1',
  sessionToken: SESSION_TOKEN,
});

const connectedTo = (hq: FakeHq): Harness => {
  const harness = createHarness({ credential: credentialOf(hq.url) });
  harnesses.push(harness);
  return harness;
};

const fakeHq = (accepts: boolean): FakeHq => {
  const hq = startFakeHq({ accepts });
  fakes.push(hq);
  return hq;
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    void harness.app.stop();
  }
  for (const hq of fakes.splice(0)) {
    hq.stop();
  }
});

describe('connected factory', () => {
  it('relays Cell claims to HQ with the session token and cell id', async () => {
    const hq = fakeHq(true);
    const harness = connectedTo(hq);
    await harness.app.tick();
    await scaleTo(harness, 1);
    const { token, cellId } = cellEnvOf(harness);

    const response = await callFactory(
      harness,
      'POST',
      `/relay${CLAIMS_PATH}`,
      CLAIM_BODY,
      bearer(token),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ code: 200, job: null });
    expect(hq.seen.filter((seen) => seen.path === CLAIMS_PATH)).toEqual([
      {
        path: CLAIMS_PATH,
        authorization: `Bearer ${SESSION_TOKEN}`,
        cellId,
      },
    ]);
  });

  it('refuses direct api calls with a conflict while connected', async () => {
    const harness = connectedTo(fakeHq(true));

    const response = await callFactory(
      harness,
      'POST',
      CLAIMS_PATH,
      CLAIM_BODY,
    );

    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      code: 409,
      type: 'refused',
      message: 'factory is connected to HQ; disconnect or omit --local',
    });
  });

  it('blocks Cell scaling while HQ has not answered', async () => {
    const harness = connectedTo(fakeHq(true));

    const response = await scaleTo(harness, 1);

    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      code: 409,
      type: 'refused',
      message: 'HQ unreachable: no Cell starts until HQ answers',
    });
    expect(harness.spawned).toHaveLength(0);
  });

  it('blocks Cell scaling once HQ rejects the credential', async () => {
    const hq = fakeHq(false);
    const harness = connectedTo(hq);
    await harness.app.tick();

    const response = await scaleTo(harness, 1);

    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      code: 409,
      type: 'refused',
      message: 'HQ rejected the credential: run "sf factory connect"',
    });
    expect(harness.spawned).toHaveLength(0);
  });
});
