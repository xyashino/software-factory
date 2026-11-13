import { defineCommand } from 'citty';
import { CallerError, type Caller } from '../caller';
import { colorPaint } from '../../paint';

/** Leaves a note for a later step (or a human) without blocking the attempt. */
export const runTell = (caller: Caller, to: string, text: string): void => {
  if (caller.isOperator) {
    throw new CallerError('the operator cannot leave notes');
  }
  if (text.trim().length === 0) {
    throw new CallerError('the note must not be empty');
  }
  const known =
    to === 'human' || caller.workflow.steps.some((step) => step.id === to);
  if (!known) {
    const steps = caller.workflow.steps.map((step) => step.id).join(', ');
    throw new CallerError(
      `unknown target "${to}"; use human or a step of this workflow: ${steps}`,
    );
  }
  caller.store.append(caller.taskId, {
    type: 'note',
    attemptId: caller.attemptId,
    to,
    text: text.trim(),
  });
};

export const tellCommand = defineCommand({
  meta: {
    name: 'tell',
    description: 'Leave a note for a later step or a human',
  },
  args: {
    to: { type: 'positional', required: true, description: 'step id or human' },
    note: { type: 'positional', required: true, description: 'the note' },
  },
  run: async ({ args }) => {
    const { withCaller } = await import('../in-pane');
    await withCaller((caller) => {
      runTell(caller, args.to, args.note);
      console.log(colorPaint.green(`noted for ${args.to}`));
    });
  },
});
