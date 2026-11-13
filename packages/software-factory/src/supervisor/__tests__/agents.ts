import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { resolveCaller } from '../../cli/caller';
import { runDone } from '../../cli/commands/done';
import { runVerdict } from '../../cli/commands/verdict';
import { reduce } from '../../engine/reduce';
import { FakeHerdr } from '../../testing/fake-herdr';
import type { AgentObservation } from '../../ports/herdr.port';
import { definitions, type Harness } from './fixtures';
import { agentName } from '../names';

/**
 * A fake agent: when the supervisor first watches a pane, the agent writes its
 * artifacts and finishes through the real `done` / `verdict` logic.
 */
export class ScriptedHerdr extends FakeHerdr {
  onFinish: ((name: string) => void) | undefined;
  private readonly finished = new Set<string>();

  override async wait(
    name: string,
    timeoutMs: number,
  ): Promise<AgentObservation> {
    if (!this.finished.has(name)) {
      this.finished.add(name);
      this.onFinish?.(name);
    }
    return super.wait(name, timeoutMs);
  }
}

export const wireAgents = (h: Harness, herdr: ScriptedHerdr): void => {
  herdr.onFinish = (name) => {
    for (const task of h.store.tasks()) {
      const workflow = definitions.workflows.get(task.workflow);
      if (workflow === undefined) continue;
      const state = reduce(workflow, h.store.events(task.id));
      const attempt = state.attempts.find(
        (item) => agentName(task.id, item.stepId, item.n) === name,
      );
      if (attempt === undefined) continue;

      for (const path of Object.values(attempt.artifacts)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${basename(path)} written by the fake agent\n`);
      }
      const caller = resolveCaller(
        {
          FACTORY_ROOT: h.root,
          FACTORY_TASK: task.id,
          FACTORY_ATTEMPT: attempt.attemptId,
        },
        h.store,
        definitions,
      );
      if (caller.role.verdict) {
        runVerdict(caller, 'pass');
      } else {
        const outcome = runDone(caller);
        if (!outcome.ok)
          throw new Error(`done refused: ${outcome.missing.join(', ')}`);
      }
      return;
    }
    throw new Error(`no attempt for ${name}`);
  };
};
