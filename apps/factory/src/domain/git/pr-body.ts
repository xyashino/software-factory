const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export const prTitleOf = (commitText: string): string =>
  commitText.trim().split('\n')[0] ?? '';

export const prChangesOf = (commitText: string): string =>
  commitText.trim().split('\n').slice(1).join('\n').trim();

export const renderPrBody = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  template.replace(PLACEHOLDER, (_, key: string) => values[key] ?? '');
