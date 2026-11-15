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
 * Sends one verb to the Cell as a JSON `POST` and reads its reply. A connection failure is an
 * `OperatorError` with exit code 3; a refusal from the Cell (4xx or 5xx with an `OperatorReply`)
 * comes back as that reply, so its message reaches the Operator.
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
    const cause = error instanceof Error ? error.message : String(error);
    throw new OperatorError(`cannot reach the Cell at ${url}: ${cause}`, 3);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OperatorError('the Cell sent a reply this CLI cannot read', 3);
  }
  return body as OperatorReply;
};
