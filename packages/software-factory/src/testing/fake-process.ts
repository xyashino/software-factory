import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ProcessPort,
  SpawnedProcess,
  SpawnExit,
  SpawnInput,
} from '../ports/process.port';

/** What a scripted process does when it runs: it may write stdout and finish. */
export type ProcessScript = (input: SpawnInput) => Promise<{
  exitCode: number | null;
  stdout?: string;
  timedOut?: boolean;
}>;

/** Records every spawn; each process answers from `script`, which defaults to a clean exit. */
export class FakeProcess implements ProcessPort {
  readonly spawned: SpawnInput[] = [];
  readonly killed: number[] = [];
  script: ProcessScript = async () => ({ exitCode: 0 });
  private nextPid = 1000;

  spawn(input: SpawnInput): SpawnedProcess {
    this.spawned.push(input);
    this.nextPid += 1;
    const exit: Promise<SpawnExit> = this.script(input).then(
      (result) => {
        mkdirSync(dirname(input.stdoutPath), { recursive: true });
        writeFileSync(input.stdoutPath, result.stdout ?? '');
        writeFileSync(input.stderrPath, '');
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut ?? false,
        };
      },
      () => ({ exitCode: null, timedOut: false }),
    );
    return { pid: this.nextPid, exit };
  }

  kill(pid: number): void {
    this.killed.push(pid);
  }
}
