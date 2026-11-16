import { renderTemplate } from './render';

/**
 * The Mechanic's prompt: the incident template with the operator verbs the Mechanic submits its
 * incident with. The Mechanic runs inside the Work order's worktree and may edit files to fix it.
 */
export const INCIDENT_TEMPLATE = `## Incident

You are the Mechanic, the on-call operator for this Andon. You are running inside the Work order's
git worktree at its current commit. Diagnose what went wrong, fix the code, tests, config, or
workflow directly in the worktree when that resolves the Andon, verify your fix, and record what
you did.

Reason: {{reason}}

{{detail}}

### Workspace failure

{{workspace}}

### Workspace log tail

{{logTail}}

### Last lines of the blocked pane

{{pane}}

### Latest judge or gate feedback

{{feedback}}

### Finish

Any edits you leave (or commit) in the worktree are committed and pushed to the Work order branch
automatically when you record your incident with \`--action repair\` or \`--action resume\`.

Record the incident once, before you resume or cancel the Work order:

    factory-operator incident --diagnosis "<what went wrong>" --action <repair|resume|cancel|nudge|escalate> --outcome "<what happened>" [--change <file|config>:<path>=<ref> ...]

If you edited files in the worktree, use \`--action repair\` (you may omit \`--change\` and the Cell
will record the commit and changed files for you). If you cannot resolve the Andon, record it with
\`--action escalate\`, or run \`factory-operator escalate --diagnosis "<why>" --outcome "<what you tried>"\`.
`;

export interface IncidentPromptInput {
  reason: string;
  detail: string;
  /** The latest `workspace_failed` behind a workspace Andon: where it broke and why. */
  workspace?: { stage: string; detail: string };
  /** The bounded tail of that failure's log, read by the Cell at render time. */
  logTail?: string;
  pane?: string;
  feedback?: string;
}

const workspaceOf = (workspace: IncidentPromptInput['workspace']): string =>
  workspace === undefined
    ? '(this Andon is not a workspace failure)'
    : `Stage: ${workspace.stage}\nDetail: ${workspace.detail}`;

/** The Mechanic's prompt for one Andon. Every placeholder has a value, so nothing is left blank by accident. */
export const buildIncidentPrompt = (input: IncidentPromptInput): string =>
  renderTemplate(INCIDENT_TEMPLATE, {
    reason: input.reason,
    detail: input.detail,
    workspace: workspaceOf(input.workspace),
    logTail:
      input.logTail === undefined
        ? '(no workspace log was captured)'
        : `\`\`\`\n${input.logTail}\n\`\`\``,
    pane: input.pane ?? '(no pane output was captured)',
    feedback: input.feedback ?? '(none)',
  });
