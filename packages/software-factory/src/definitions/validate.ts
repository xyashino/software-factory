import { statSync } from 'node:fs';
import { join } from 'node:path';
import { getRunner } from '../adapters/runners/registry';
import type { DefinitionError } from './errors';
import type { NitpickCatalog } from './nitpick-catalog';
import type { AgentDef, ArtifactRef, Role, Step, Workflow } from './types';

/** No `task.*` field is a supported workflow input. */
const SUPPORTED_TASK_FIELDS: readonly string[] = [];

/**
 * Checks that every rule a role declares is a rule or group in
 * `.nitpick/config.ts` and every skill has `.nitpick/skills/<id>/SKILL.md`.
 */
export const validateRoleCatalog = (
  file: string,
  role: Role,
  catalog: NitpickCatalog,
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
  role.rules.forEach((id, index) => {
    if (!catalog.ruleIds.has(id)) {
      errors.push({
        file,
        field: `rules[${index}]`,
        message: `no rule ${id} in .nitpick/config.ts rules`,
      });
    }
  });
  role.skills.forEach((id, index) => {
    if (!isFile(join(catalog.skillsDir, id, 'SKILL.md'))) {
      errors.push({
        file,
        field: `skills[${index}]`,
        message: `no skill file .nitpick/skills/${id}/SKILL.md`,
      });
    }
  });
  return errors;
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export interface LoadedWorkflow {
  /** path relative to the package root, for error messages */
  file: string;
  workflow: Workflow;
}

/**
 * Checks one workflow against the loaded roles. Every rule about step order,
 * artifact origin, retries and judging roles lives here.
 */
export const validateWorkflow = (
  file: string,
  workflow: Workflow,
  roles: ReadonlyMap<string, Role>,
  brokenRoles: ReadonlySet<string> = new Set(),
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
  const fail = (field: string, message: string): void => {
    errors.push({ file, field, message });
  };

  const stepIndex = new Map<string, number>();
  workflow.steps.forEach((step, index) => {
    if (stepIndex.has(step.id)) {
      fail(`steps[${index}].id`, `duplicate step id "${step.id}"`);
    } else {
      stepIndex.set(step.id, index);
    }
  });

  const roleOfAgent = (key: string): Role | undefined => {
    const agent = workflow.agents[key];
    return agent === undefined ? undefined : roles.get(agent.role);
  };

  const runnerProblems = (path: string, agent: AgentDef): void => {
    const runner = getRunner(agent.runner);
    if (agent.headless && runner?.headlessArgs === undefined) {
      fail(
        `${path}.headless`,
        `runner "${agent.runner}" has no print mode; headless needs one that does`,
      );
    }
    if (agent.permission === 'read' && runner?.readOnly !== true) {
      fail(
        `${path}.permission`,
        `runner "${agent.runner}" has no read-only mode; permission: read needs one that does`,
      );
    }
  };

  for (const [key, agent] of Object.entries(workflow.agents)) {
    if (!roles.has(agent.role) && !brokenRoles.has(agent.role)) {
      fail(`agents.${key}.role`, `unknown role "${agent.role}"`);
    }
    runnerProblems(`agents.${key}`, agent);
  }

  if (workflow.operator !== undefined) {
    if (workflow.operator.headless) {
      fail(
        'operator.headless',
        'the operator needs a pane; headless is not allowed',
      );
    }
    if (workflow.operator.permission === 'read') {
      fail(
        'operator.permission',
        'the operator changes files; permission must be write',
      );
    }
    const operatorRole = roles.get(workflow.operator.role);
    if (operatorRole === undefined) {
      if (!brokenRoles.has(workflow.operator.role)) {
        fail('operator.role', `unknown role "${workflow.operator.role}"`);
      }
    } else if (operatorRole.verdict) {
      fail(
        'operator.role',
        `role "${operatorRole.id}" judges its step; the operator finishes with \`sf done\``,
      );
    }
  }

  const usedAgents = new Set<string>();

  const artifactProblem = (ref: ArtifactRef, before: number): string | null => {
    const index = stepIndex.get(ref.stepId);
    if (index === undefined) {
      return `unknown step "${ref.stepId}"`;
    }
    if (index >= before) {
      return `step "${ref.stepId}" must come before this step`;
    }
    const producer = workflow.steps[index];
    if (producer?.type !== 'agent') {
      return `step "${ref.stepId}" is a commands step and produces no artifacts`;
    }
    const role = roleOfAgent(producer.agent);
    if (role !== undefined && !Object.hasOwn(role.artifacts, ref.artifactKey)) {
      return `step "${ref.stepId}" does not produce artifact "${ref.artifactKey}"`;
    }
    return null;
  };

  const gateProblem = (stepId: string, before: number): string | null => {
    const index = stepIndex.get(stepId);
    if (index === undefined) {
      return `unknown step "${stepId}"`;
    }
    if (index >= before) {
      return `step "${stepId}" must come before this step`;
    }
    if (workflow.steps[index]?.type !== 'commands') {
      return `step "${stepId}" is an agent step; "${stepId}.gate" needs a commands step`;
    }
    return null;
  };

  const retryProblem = (retry: string, index: number): string | null => {
    const target = stepIndex.get(retry);
    if (target === undefined) {
      return `unknown step "${retry}"`;
    }
    if (target >= index) {
      return `"${retry}" must be an earlier step`;
    }
    if (workflow.steps[target]?.type !== 'agent') {
      return `"${retry}" is a commands step; retry must target an agent step`;
    }
    return null;
  };

  workflow.steps.forEach((step: Step, index) => {
    const prefix = `steps[${index}]`;

    if (step.onFail !== undefined) {
      const problem = retryProblem(step.onFail.retry, index);
      if (problem !== null) {
        fail(`${prefix}.onFail.retry`, problem);
      }
    }

    if (step.type !== 'agent') {
      return;
    }

    usedAgents.add(step.agent);
    const role = roleOfAgent(step.agent);
    if (!Object.hasOwn(workflow.agents, step.agent)) {
      fail(
        `${prefix}.agent`,
        `unknown agent "${step.agent}"; declare it under agents:`,
      );
    }

    if (step.onFail !== undefined && role !== undefined && !role.verdict) {
      fail(
        `${prefix}.onFail`,
        `only a judging role (verdict: true) can fail a step; role "${role.id}" is not judging`,
      );
    }

    step.inputs.forEach((ref, inputIndex) => {
      const field = `${prefix}.inputs[${inputIndex}]`;
      if ('source' in ref && ref.source === 'gate') {
        const problem = gateProblem(ref.stepId, index);
        if (problem !== null) {
          fail(field, problem);
        }
        return;
      }
      if ('source' in ref) {
        if (!SUPPORTED_TASK_FIELDS.includes(ref.field)) {
          fail(
            field,
            `unknown task input "task.${ref.field}"; no task inputs are supported`,
          );
        }
        return;
      }
      const problem = artifactProblem(ref, index);
      if (problem !== null) {
        fail(field, problem);
      }
    });
  });

  for (const key of Object.keys(workflow.agents)) {
    if (!usedAgents.has(key)) {
      fail(`agents.${key}`, 'is not used by any step');
    }
  }

  const deliverRefs: Array<[string, ArtifactRef]> = [
    ['deliver.commit', workflow.deliver.commit],
    ['deliver.report', workflow.deliver.report],
  ];
  for (const [field, ref] of deliverRefs) {
    const problem = artifactProblem(ref, workflow.steps.length);
    if (problem !== null) {
      fail(field, problem);
    }
  }

  return errors;
};
