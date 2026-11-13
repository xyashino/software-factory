export type GuideKind = 'worker' | 'judge' | 'operator';

const DONE =
  '- `sf done`: finish the step. Refuses, and names the files, if an artifact is missing or empty.';
const ASK =
  '- `sf ask <operator|human> "<question>"`: ask when you are stuck. The step waits for the answer, which arrives in this pane; its timeout is paused meanwhile. `human` skips the operator.';
const TELL =
  '- `sf tell <step|human> "<note>"`: leave a note for a later step (or a human). Does not wait for an answer.';

/** The `sf` commands an agent may run, as lines of the CLI guide. */
export const renderCliCommands = (kind: GuideKind): string[] => {
  switch (kind) {
    case 'worker':
      return [DONE, ASK, TELL];
    case 'judge':
      return [
        '- `sf verdict pass`: the step passes. Optional: write a `feedback.md` first.',
        '- `sf verdict fail`: the step fails. Requires feedback: pipe it in with `sf verdict fail --feedback -` (stdin), or a non-empty `feedback.md` in the attempt directory.',
        ASK,
        TELL,
      ];
    case 'operator':
      return [
        DONE,
        '- `sf answer <taskId> "<answer>"`: answer the open question of a waiting agent.',
        '- `sf unblock <taskId> [--choose <n> | --nudge "<text>"]`: resume a blocked task. A runner prompt needs `--choose <n>` for a numbered menu (presses n, then Enter), or `--nudge` text for the pane; an exhausted retry budget gets one extra retry per task.',
        '- `sf escalate <taskId> "<summary>"`: hand the incident to a human with a summary.',
      ];
  }
};

/** The guide kind of a role: judging roles finish with a verdict. */
export const guideKind = (role: { verdict: boolean }): GuideKind => {
  return role.verdict ? 'judge' : 'worker';
};
