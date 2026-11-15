import type {
  OperatorReply,
  OperatorVerb,
} from '@repo/factory-core/contracts/operator';

/** The one place this CLI touches the network: the Cell's localhost endpoint, nothing else. */
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

/**
 * Sends one verb to the Cell as a `POST` and reads its JSON reply. A connection failure or a reply
 * that is not JSON is an `OperatorError` with exit code 3; a refusal from the Cell (a non-2xx status
 * with an `OperatorReply` body) comes back as the reply, with its own code and message.
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
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new OperatorError(`cannot reach the Cell at ${url}: ${detail}`, 3);
  }
  let reply: unknown;
  try {
    reply = await response.json();
  } catch {
    throw new OperatorError('the Cell sent a reply this CLI cannot read', 3);
  }
  return reply as OperatorReply;
};
