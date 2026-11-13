import type { BlockReason } from './events';

/** What the supervisor must do next. The engine returns one; the supervisor performs it. */
export type SupervisorAction =
  | { type: 'idle' }
  | { type: 'setup' }
  | {
      type: 'start_attempt';
      stepId: string;
      n: number;
      restartOf?: string;
      feedbackFrom?: string;
      restoreSnapshot?: string;
    }
  | { type: 'watch'; attemptId: string }
  | { type: 'deliver'; to: 'new-pr' }
  | {
      type: 'start_operator';
      reason: 'retries_exhausted' | 'infra' | 'runner_prompt' | 'question';
      detail: string;
      questionId?: string;
    }
  | {
      type: 'deliver_prompt';
      attemptId: string;
      kind: 'answer' | 'nudge' | 'keys';
      text: string;
      keys?: string[];
      question?: string;
    }
  | { type: 'block'; reason: BlockReason; detail: string };
