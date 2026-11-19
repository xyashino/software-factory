import type { Verb, VerbOption } from './verbs/define-verb';

const INDENT = '  ';

const optionLine = (option: VerbOption): string =>
  `${INDENT}${INDENT}${option.flag} <value>${option.required ? '' : ' (optional)'}`;

const verbBlock = (verb: Verb): string[] => [
  `${INDENT}${verb.name}  ${verb.description}`,
  ...verb.options.map(optionLine),
];

export const usage = (program: string, verbs: readonly Verb[]): string =>
  [
    `Usage: ${program} <verb> [options]`,
    '',
    'Verbs:',
    ...verbs.flatMap(verbBlock),
  ].join('\n');
