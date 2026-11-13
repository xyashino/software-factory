import type { AgentStep, Role, Workflow } from './definitions/types';
import { OPERATOR_STEP } from './engine/state';

/** What a step is, for people: its role label plus how its agent runs. */
export interface StepDescription {
  label: string;
  runner: string | undefined;
  model: string | undefined;
}

const describeAgentStep = (
  workflow: Workflow,
  roles: ReadonlyMap<string, Role>,
  step: AgentStep,
): StepDescription => {
  const agent = workflow.agents[step.agent];
  const role = agent === undefined ? undefined : roles.get(agent.role);
  return {
    label: role?.label ?? step.agent,
    runner: agent?.runner,
    model: agent?.model,
  };
};

/** Describes a step by its role label; a commands step has no runner. */
export const describeStep = (
  workflow: Workflow,
  roles: ReadonlyMap<string, Role>,
  stepId: string,
): StepDescription | undefined => {
  if (stepId === OPERATOR_STEP) {
    const agent = workflow.operator;
    if (agent === undefined) return undefined;
    return {
      label: roles.get(agent.role)?.label ?? 'Operator',
      runner: agent.runner,
      model: agent.model,
    };
  }
  const step = workflow.steps.find((item) => item.id === stepId);
  if (step === undefined) return undefined;
  if (step.type !== 'agent') {
    return { label: 'Commands', runner: undefined, model: undefined };
  }
  return describeAgentStep(workflow, roles, step);
};
