import { describe, expect, it } from 'vitest';
import {
  blockVerb,
  contextVerb,
  doneVerb,
  incidentVerb,
  operatorRequest,
  readVerb,
  verdictVerb,
} from '../../../src/contracts/operator.contract';

const TOKEN = 'cycle-token';

describe('operator contract', () => {
  it('accepts a done verb with the job token', () => {
    // Arrange
    const request = { verb: 'done', token: TOKEN };

    // Act
    const result = doneVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a done verb with an unknown key', () => {
    // Arrange
    const request = { verb: 'done', token: TOKEN, extra: true };

    // Act
    const result = doneVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a verdict pass without feedback', () => {
    // Arrange
    const request = { verb: 'verdict', outcome: 'pass', token: TOKEN };

    // Act
    const result = verdictVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a verdict fail with no feedback', () => {
    // Arrange
    const request = { verb: 'verdict', outcome: 'fail', token: TOKEN };

    // Act
    const result = verdictVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a block with a reason and handover content', () => {
    // Arrange
    const request = {
      verb: 'block',
      reason: 'needs a human',
      handover: '## What happened',
      token: TOKEN,
    };

    // Act
    const result = blockVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a block with a handover path key instead of content', () => {
    // Arrange
    const request = {
      verb: 'block',
      reason: 'needs a human',
      handoverPath: 'handover.md',
      token: TOKEN,
    };

    // Act
    const result = blockVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a context verb and a read verb', () => {
    // Arrange
    const context = { verb: 'context', token: TOKEN };
    const read = { verb: 'read', token: TOKEN };

    // Act
    const parsedContext = contextVerb.safeParse(context);
    const parsedRead = readVerb.safeParse(read);

    // Assert
    expect(parsedContext.success).toBe(true);
    expect(parsedRead.success).toBe(true);
  });

  it('rejects an incident restart_from_step with no step', () => {
    // Arrange
    const request = {
      verb: 'incident',
      action: 'restart_from_step',
      diagnosis: 'lint failed',
      outcome: 'retried once',
      report: '## What happened',
      token: TOKEN,
    };

    // Act
    const result = incidentVerb.safeParse(request);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts an incident escalate with a report and no step', () => {
    // Arrange
    const request = {
      verb: 'incident',
      action: 'escalate',
      diagnosis: 'lint failed',
      outcome: 'retried once',
      report: '## What happened',
      token: TOKEN,
    };

    // Act
    const result = operatorRequest.safeParse(request);

    // Assert
    expect(result.success).toBe(true);
  });
});
