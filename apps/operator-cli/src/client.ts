import type {
  OperatorReply,
  OperatorVerb,
} from '@repo/factory-core/contracts/operator';

/** The Cell's endpoint for this Cycle, and the Cycle token that gates it. */
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
 * Sends one verb to the Cell as a `POST` with the Cycle token, and reads one JSON reply. A failure to
 * reach the Cell, or a reply that is not JSON, is an `OperatorError` with exit code 3; a refusal from
 * the Cell is returned as an `ok: false` reply and keeps its own message.
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
  try {
    return (await response.json()) as OperatorReply;
  } catch {
    throw new OperatorError('the Cell sent a reply this CLI cannot read', 3);
  }
};
