import type { Signal } from '@repo/factory-core/contracts/cell';

/** The runtime prompts a Cell types into an Operator, as the Line's definitions name them. */
export interface RuntimePromptSet {
  answer: string;
  nudge: string;
  idleReminder: string;
  silentReminder: string;
  handoverRequest: string;
}

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Fills `{{name}}` placeholders from `vars`. A placeholder with no value is left as written: a typed
 * prompt never gets an empty hole in it.
 */
export const fillPrompt = (
  template: string,
  vars: Readonly<Record<string, string>>,
): string =>
  template.replace(PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] ?? match) : match,
  );

/** The text a signal types into the Operator (PROTOCOL §7); nothing else is ever typed. */
export const typedFor = (signal: Signal, prompts: RuntimePromptSet): string => {
  switch (signal.kind) {
    case 'answer':
      return fillPrompt(prompts.answer, { text: signal.text });
    case 'nudge':
      return fillPrompt(prompts.nudge, { text: signal.text });
  }
};
