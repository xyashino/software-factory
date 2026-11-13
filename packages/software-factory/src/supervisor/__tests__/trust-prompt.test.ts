import { describe, expect, it } from 'vitest';
import { FakeHerdr } from '../../testing/fake-herdr';
import { confirmTrustPrompt } from '../trust-prompt';

const TRUST_SCREEN = [
  'Do you trust the contents of this project?',
  '',
  'Antigravity CLI requires permission to read, edit,',
  '',
  '> Yes, I trust this folder',
  '  No, exit',
].join('\n');

describe('confirmTrustPrompt', () => {
  it('presses Enter on the trust screen and reports it confirmed', async () => {
    const herdr = new FakeHerdr();
    herdr.screenText = TRUST_SCREEN;

    await expect(confirmTrustPrompt(herdr, 'agent_1')).resolves.toBe(true);
    expect(
      herdr.calls.find((call) => call.method === 'sendKeys')?.args,
    ).toEqual(['agent_1', 'Enter']);
  });

  it('leaves any other blocked screen alone', async () => {
    const herdr = new FakeHerdr();
    herdr.screenText = 'Allow command "rm -rf build"? (y/n)';

    await expect(confirmTrustPrompt(herdr, 'agent_1')).resolves.toBe(false);
    expect(herdr.calls.some((call) => call.method === 'sendKeys')).toBe(false);
  });
});
