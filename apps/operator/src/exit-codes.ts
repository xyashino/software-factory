export type ArgumentError = { kind: 'argument_error'; message: string };

export type Result =
  | { kind: 'ok' }
  | { kind: 'refused'; code: string; message: string }
  | ArgumentError
  | { kind: 'unreachable'; message: string };

export type ExitCode = 0 | 1 | 2 | 3;

const unexpected = (value: never): never => {
  throw new Error(`unhandled result: ${JSON.stringify(value)}`);
};

export const exitCodeFor = (result: Result): ExitCode => {
  switch (result.kind) {
    case 'ok':
      return 0;
    case 'refused':
      return 1;
    case 'argument_error':
      return 2;
    case 'unreachable':
      return 3;
    default:
      return unexpected(result);
  }
};

export const lineFor = (result: Result): string => {
  switch (result.kind) {
    case 'ok':
      return 'ok: true';
    case 'refused':
      return `${result.code}: ${result.message}`;
    case 'argument_error':
    case 'unreachable':
      return result.message;
    default:
      return unexpected(result);
  }
};
