import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OperatorError } from '../client';
import { toRequest } from '../cli';

const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
const TOKEN = 'b'.repeat(48);

let root: string;
let socketPath: string;
let stubProcess: { kill(): void } | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'op-cli-'));
  socketPath = join(root, 'op.sock');
});

afterEach(() => {
  stubProcess?.kill();
  stubProcess = undefined;
  rmSync(root, { recursive: true, force: true });
});

const STUB = fileURLToPath(new URL('./stub-cell.ts', import.meta.url));

/** A stub Cell socket in its own process: it records each request line and answers with `reply`. */
const stubCell = async (reply: unknown): Promise<void> => {
  stubProcess = Bun.spawn(['bun', STUB, socketPath, JSON.stringify(reply)], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(socketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the stub Cell socket never appeared');
};

/** The requests the stub Cell has received, one JSON line each. */
const receivedRequests = (): string[] =>
  existsSync(`${socketPath}.log`)
    ? readFileSync(`${socketPath}.log`, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
    : [];

/** Runs the CLI as a process with the given environment; returns its exit code and output. */
const runCli = async (
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> => {
  const started = performance.now();
  // The Cell's own variables are dropped so each case sets exactly what it tests.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('FACTORY_'),
    ),
  );
  const child = Bun.spawn(['bun', CLI, ...args], {
    env: { ...inherited, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    code: await child.exited,
    stdout,
    stderr,
    ms: performance.now() - started,
  };
};

describe('factory-operator argv', () => {
  it('maps done, context and ask to their verbs', () => {
    expect(toRequest(['done'])).toEqual({ op: 'done' });
    expect(toRequest(['context'])).toEqual({ op: 'context' });
    expect(toRequest(['ask', 'which database?'])).toEqual({
      op: 'ask',
      text: 'which database?',
    });
  });

  it('maps a passing verdict without reading any file', () => {
    expect(toRequest(['verdict', 'pass'])).toEqual({
      op: 'verdict',
      pass: true,
    });
  });

  it('reads the feedback file of a failing verdict', () => {
    const feedback = join(mkdtempSync(join(tmpdir(), 'op-fb-')), 'feedback.md');
    writeFileSync(feedback, 'missing the error case\n');
    expect(toRequest(['verdict', 'fail', '--feedback', feedback])).toEqual({
      op: 'verdict',
      pass: false,
      feedback: 'missing the error case\n',
    });
    rmSync(feedback, { force: true });
  });

  it('refuses a failing verdict with no feedback file, with a clear message', () => {
    expect(() => toRequest(['verdict', 'fail'])).toThrow(/--feedback/);
  });

  it('reads the Handover file of a block and keeps the reason', () => {
    const handover = join(mkdtempSync(join(tmpdir(), 'op-ho-')), 'handover.md');
    writeFileSync(handover, 'next step: write the migration\n');
    expect(
      toRequest(['block', '--reason', 'stuck', '--handover', handover]),
    ).toEqual({
      op: 'block',
      reason: 'stuck',
      handover: 'next step: write the migration\n',
    });
    rmSync(handover, { force: true });
  });

  it('names the missing file of a block instead of crashing', () => {
    expect(() =>
      toRequest([
        'block',
        '--reason',
        'x',
        '--handover',
        join(root, 'none.md'),
      ]),
    ).toThrow(OperatorError);
  });

  it('sends a note to a station or to the supervisor', () => {
    expect(toRequest(['tell', 'build', 'the schema is ready'])).toEqual({
      op: 'tell',
      to: 'build',
      text: 'the schema is ready',
    });
    expect(toRequest(['tell', 'supervisor', 'help'])).toMatchObject({
      to: 'supervisor',
    });
  });

  it('refuses an unknown command with exit code 2 and the usage', () => {
    expect(() => toRequest(['explode'])).toThrow(/unknown command "explode"/);
  });
});

describe('factory-operator process', () => {
  it('exits 0 and prints the reply result for a verb the Cell accepts', async () => {
    await stubCell({
      ok: true,
      result: { cycleId: '01J', outputs: ['plan.md'] },
    });

    const run = await runCli(['context'], {
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: TOKEN,
    });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      cycleId: '01J',
      outputs: ['plan.md'],
    });
    expect(JSON.parse(receivedRequests()[0] ?? '{}')).toEqual({
      op: 'context',
      token: TOKEN,
    });
  });

  it('exits 1 and names the code when the Cell refuses the verb', async () => {
    await stubCell({
      ok: false,
      code: 'precondition',
      message: 'the Cycle is not live',
    });

    const run = await runCli(['done'], {
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: TOKEN,
    });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('precondition: the Cycle is not live');
  });

  it('exits 2 and says what is missing when the environment is not set', async () => {
    const run = await runCli(['done'], { FACTORY_CYCLE_TOKEN: TOKEN });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('FACTORY_OPERATOR_SOCKET is not set');
  });

  it('exits 3 when the socket cannot be reached', async () => {
    const run = await runCli(['done'], {
      FACTORY_OPERATOR_SOCKET: join(root, 'missing.sock'),
      FACTORY_CYCLE_TOKEN: TOKEN,
    });

    expect(run.code).toBe(3);
    expect(run.stderr).toContain('cannot reach the Cell');
  });

  it('starts in under 100 ms, the median of five runs after a warm-up', async () => {
    await stubCell({ ok: true, result: {} });
    const env = {
      FACTORY_OPERATOR_SOCKET: socketPath,
      FACTORY_CYCLE_TOKEN: TOKEN,
    };
    // The first spawn pays the cold module cache; it is run and not timed.
    await runCli(['context'], env);
    const timings: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const run = await runCli(['context'], env);
      expect(run.code).toBe(0);
      timings.push(run.ms);
    }
    const median =
      [...timings].sort((a, b) => a - b)[2] ?? Number.POSITIVE_INFINITY;
    console.log(
      `factory-operator startup, median of 5 after warm-up: ${median.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(100);
  });

  it('talks only to its socket: no network stack, no other path', () => {
    const sources = ['cli.ts', 'client.ts', 'usage.ts'].map((name) =>
      readFileSync(
        fileURLToPath(new URL(`../${name}`, import.meta.url)),
        'utf8',
      ),
    );
    for (const source of sources) {
      expect(source).not.toMatch(
        /fetch\(|node:http|node:https|node:dgram|\bhttp:\/\//,
      );
    }
    expect(sources[1]).toContain('createConnection(socketPath)');
  });
});
