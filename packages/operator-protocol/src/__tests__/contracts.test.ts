import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VERBS } from '../constants';
import { operatorReplySchema } from '../replies';
import {
  blockContract,
  contextContract,
  doneContract,
  verdictContract,
} from '../verbs/operator.contract';
import { incidentContract, readContract } from '../verbs/mechanic.contract';

const TOKEN = 'a'.repeat(32);

const contracts: [string, z.ZodType, Record<string, unknown>][] = [
  ['done', doneContract.body, { verb: 'done', token: TOKEN }],
  [
    'verdict',
    verdictContract.body,
    { verb: 'verdict', result: 'pass', token: TOKEN },
  ],
  [
    'block',
    blockContract.body,
    { verb: 'block', reason: 'stuck on lint', handover: 'notes', token: TOKEN },
  ],
  ['context', contextContract.body, { verb: 'context', token: TOKEN }],
  ['read', readContract.body, { verb: 'read', token: TOKEN }],
  [
    'incident',
    incidentContract.body,
    {
      verb: 'incident',
      action: 'cancel',
      report: '## What happened',
      token: TOKEN,
    },
  ],
];

const validReplies: unknown[] = [
  { ok: true },
  { ok: false, code: 'invalid', message: 'bad' },
  { ok: false, code: 'unauthorized', message: 'no token' },
  { ok: false, code: 'rejected', message: 'not allowed' },
  { ok: false, code: 'stale_epoch', message: 'old epoch' },
  { ok: false, code: 'not_live', message: 'not running' },
  { ok: false, code: 'precondition', message: 'missing file' },
  { ok: false, code: 'internal', message: 'boom' },
];

describe('operator verb contracts', () => {
  it.each(contracts)('%s accepts a valid body', (_verb, schema, body) => {
    const result = schema.safeParse(body);

    expect(result.success).toBe(true);
  });

  it.each(contracts)('%s rejects an unknown verb', (_verb, schema, body) => {
    const result = schema.safeParse({ ...body, verb: 'nudge' });

    expect(result.success).toBe(false);
  });

  it.each(contracts)('%s rejects a missing token', (_verb, schema, body) => {
    const result = schema.safeParse({ ...body, token: undefined });

    expect(result.success).toBe(false);
  });

  it.each(contracts)('%s rejects an extra field', (_verb, schema, body) => {
    const result = schema.safeParse({ ...body, extra: 'x' });

    expect(result.success).toBe(false);
  });

  it('covers every verb with exactly one contract', () => {
    const covered = contracts.map(([verb]) => verb).sort();

    expect(covered).toEqual([...VERBS].sort());
  });
});

describe('verdict contract', () => {
  it('accepts a fail with feedback', () => {
    const result = verdictContract.body.safeParse({
      verb: 'verdict',
      result: 'fail',
      feedback: 'missing test',
      token: TOKEN,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a fail without feedback', () => {
    const result = verdictContract.body.safeParse({
      verb: 'verdict',
      result: 'fail',
      token: TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a pass that carries feedback', () => {
    const result = verdictContract.body.safeParse({
      verb: 'verdict',
      result: 'pass',
      feedback: 'extra',
      token: TOKEN,
    });

    expect(result.success).toBe(false);
  });
});

describe('incident contract', () => {
  it('accepts restart_from_step with a step', () => {
    const result = incidentContract.body.safeParse({
      verb: 'incident',
      action: 'restart_from_step',
      step: 'step-02',
      report: '## What happened',
      token: TOKEN,
    });

    expect(result.success).toBe(true);
  });

  it('rejects restart_from_step without a step', () => {
    const result = incidentContract.body.safeParse({
      verb: 'incident',
      action: 'restart_from_step',
      report: '## What happened',
      token: TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an action outside the five values', () => {
    const result = incidentContract.body.safeParse({
      verb: 'incident',
      action: 'pause',
      report: '## What happened',
      token: TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it('accepts an incident without diagnosis and outcome', () => {
    const result = incidentContract.body.safeParse({
      verb: 'incident',
      action: 'escalate',
      report: '## What happened',
      token: TOKEN,
    });

    expect(result.success).toBe(true);
  });
});

describe('reply shapes', () => {
  it.each(validReplies)('accepts the reply %j', (reply) => {
    const result = operatorReplySchema.safeParse(reply);

    expect(result.success).toBe(true);
  });

  it('rejects a reply code outside the set', () => {
    const result = operatorReplySchema.safeParse({
      ok: false,
      code: 'teapot',
      message: 'no',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an ok reply that carries a message', () => {
    const result = operatorReplySchema.safeParse({ ok: true, message: 'x' });

    expect(result.success).toBe(false);
  });
});
