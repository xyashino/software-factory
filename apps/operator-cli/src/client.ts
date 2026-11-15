import {
  operatorReplySchema,
  type OperatorReply,
  type OperatorVerb,
} from '@repo/factory-core/contracts/operator';

/** The one place this CLI touches the network: the Cell's localhost Operator endpoint, nothing else. */
export const URL_ENV = 'FACTORY_OPERATOR_URL';
export const TOKEN_ENV = 'FACTORY_CYCLE_TOKEN';

/** A failure the Operator must see: its message, and the exit code it maps to. */
export class OperatorError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'OperatorError';
    this.exitCode = exitCode;
  }
}

/** The reason a request failed before any reply: the error code when there is one. */
const reasonOf = (error: unknown): string => {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Sends one verb to the Cell as a `POST` with the Cycle token, and reads one reply. A connection
 * failure or an unreadable reply is an `OperatorError` with exit code 3; a refusal from the Cell
 * is returned as its `OperatorReply`, so the caller prints its code and message.
 */
export const callCell = async (
  url: string,
  request: OperatorVerb,
  token: string,
): Promise<OperatorReply> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...request, token }),
    });
  } catch (error) {
    throw new OperatorError(
      `cannot reach the Cell at ${url}: ${reasonOf(error)}`,
      3,
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new OperatorError(
      'the Cell closed the connection without a reply',
      3,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OperatorError('the Cell sent a reply this CLI cannot read', 3);
  }
  const reply = operatorReplySchema.safeParse(body);
  if (!reply.success) {
    throw new OperatorError('the Cell sent a reply this CLI cannot read', 3);
  }
  return reply.data;
};
