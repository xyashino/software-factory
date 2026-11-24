const UNTRUSTED_CONTROL = /(?![\t\n\r])[\p{Cc}\p{Cf}]/gu;

export const sanitizeUntrustedText = (input: string): string =>
  input.replace(UNTRUSTED_CONTROL, '');
