import { renderTemplate } from './render';

/**
 * The Mechanic's prompt (CORE §14.4): the v1 `incident.md` shape, with the operator verbs the Mechanic
 * submits its incident with. The pane tail and the feedback are filled in by the caller when known.
 */
export const INCIDENT_TEMPLATE = `## Incident

You are the Mechanic, the on-call operator for this Andon. Work out what went wrong, repair the
workflow if that is the fix, and record what you did. You may not edit the Work order's worktree.

Reason: {{reason}}

{{detail}}

### Last lines of the blocked pane

{{pane}}

### Latest judge or gate feedback

{{feedback}}

### Finish

Record the incident once, before you resume or cancel the Work order:

    factory-operator incident --diagnosis "<what went wrong>" --action <resume|cancel|nudge|escalate|repair> --outcome "<what happened>" [--change <file|config>:<path>=<ref> ...]

If you cannot resolve the Andon, record it with \`--action escalate\`, or run
\`factory-operator escalate --diagnosis "<why>" --outcome "<what you tried>"\`.
`;

export interface IncidentPromptInput {
  reason: string;
  detail: string;
  pane?: string;
  feedback?: string;
}

/** The Mechanic's prompt for one Andon. Every placeholder has a value, so nothing is left blank by accident. */
export const buildIncidentPrompt = (input: IncidentPromptInput): string =>
  renderTemplate(INCIDENT_TEMPLATE, {
    reason: input.reason,
    detail: input.detail,
    pane: input.pane ?? '(no pane output was captured)',
    feedback: input.feedback ?? '(none)',
  });
