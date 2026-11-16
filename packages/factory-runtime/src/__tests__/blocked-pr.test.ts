import { describe, expect, it } from 'vitest';
import { formatBlockedPr } from '../pr-body';
import { shippedDefinitions } from './test-kit';

const BLOCKED = {
  taskId: 'add-login',
  reason: 'cycle_blocked',
  detail: 'cycle 01J0000000000000000000000C is blocked',
  logCommand: 'factory log software-factory:add-login',
};

describe('formatBlockedPr (v1 publishBlockedWork)', () => {
  it('titles the PR [BLOCKED] <taskId> <reason>', () => {
    const { prTemplates } = shippedDefinitions();
    const { title } = formatBlockedPr(BLOCKED, prTemplates);

    expect(title).toBe('[BLOCKED] add-login cycle_blocked');
  });

  it('renders the blocked template with the reason, the detail and the log command', () => {
    const { prTemplates } = shippedDefinitions();
    const { body } = formatBlockedPr(BLOCKED, prTemplates);

    expect(body).toContain('add-login');
    expect(body).toContain('cycle_blocked');
    expect(body).toContain(BLOCKED.detail);
    expect(body).toContain(`Event log: \`${BLOCKED.logCommand}\``);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('refuses a template set without the blocked template', () => {
    const { prTemplates } = shippedDefinitions();
    const withoutBlocked = new Map(prTemplates);
    withoutBlocked.delete('blocked');

    expect(() => formatBlockedPr(BLOCKED, withoutBlocked)).toThrow(
      /PR template "blocked" is not loaded/,
    );
  });
});
